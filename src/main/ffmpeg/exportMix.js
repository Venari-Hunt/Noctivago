import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { runFfmpegToFile } from './runFfmpeg.js'
import { renderClipToPath } from './loopClip.js'

// "Export" (plugins/export/): bakes a whole preset down to one audio file of
// a chosen length/format, rather than playing it live. The renderer side
// (plugins/export/simulate.js) already worked out *when* each sound's shots
// would land over the export's duration - reusing the exact same
// randomization/scheduling math the real playback sources use, just run as
// a dry loop instead of a real audio-scheduling timer - and hands this
// module a plain event list per sound. This module only has to answer *how*
// to actually render that into audio.
//
// PIPELINE (rewritten for speed, see the task-list "MAKE MULTI-HOUR EXPORT
// AS FAST AS POSSIBLE" item - the old shape ran one full-export-duration
// ffmpeg pass *per sound per event-batch* plus a combine plus a final
// mixdown, ~2N+2 full-duration passes; a 3h export with a couple of Random
// Interval sounds churned through 100+ hours of audio):
//
// 1. One short "shot" clip per sound (reusing loopClip.js's bake, unchanged;
//    a loop sound's already-cached clip is reused directly when its
//    trim/filters/crossfade/speed still match - see cachedClipPath).
// 2. For a scatter/scheduled sound, one *sliced* batch track per
//    EVENT_BATCH_SIZE events, rendered over only that batch's real time span
//    (the events are chronological - verified in simulate.js - so a batch is
//    a contiguous slice), not padded to the whole export length. The sum of
//    every batch's span across every sound is ~1x the export duration total,
//    instead of nBatches x duration.
// 3. One final ffmpeg pass: every loop sound's short shot as a
//    `-stream_loop -1 -i` input through `volume`, every sliced batch track
//    `adelay`'d to its absolute offset, all `amix`ed together (normalize=0 -
//    honest summing, matching how the live Mixer's own AudioContext sums its
//    per-sound gains rather than auto-dividing by sound count), then the
//    whole-mix highpass/lowpass/gain and fade in/out applied *last* (the
//    owner's explicit ordering), then encoded. The rubberband pitch work all
//    happened already in the (short) sliced-batch renders, so this pass is
//    cheap PCM mixing + one encode even for a multi-hour output.
//
// Intermediates are FLAC (roughly halves the multi-GB temp I/O a long dense
// export writes; codec cost is negligible next to that) and forced to
// stereo/44.1k so the final `amix` never hits a channel-layout mismatch.
//
// Steps 1 and 2 are all mutually independent passes. By default they run one
// at a time (concurrency 1). With `fasterExport` (the export:run handler
// passes settings.fasterExport straight through) they run `concurrency` at a
// time via mapPool - bounded by core count and FASTER_EXPORT_CONCURRENCY_CAP
// - and rubberband switches to its faster pitch mode. Step 3 is one pass
// regardless.

// EVENT_BATCH_SIZE branches of rubberband+volume+fade+adelay go into one
// ffmpeg graph per batch. rubberband's cost is proportional to a shot's
// duration and ffmpeg runs a graph's branches on one thread, so this is
// bounded on purpose - a documented "took all my RAM and never finished"
// bug (v0.1.85) came from putting every event's rubberband into a single
// graph. 25 branches were measured safe (~40s/500MB); this keeps a margin.
// Unlike the pre-rewrite version each batch graph is now only `apad`'d to
// its own span, not the whole export length, so peak memory per batch is
// meaningfully lower than even that measurement.
const EVENT_BATCH_SIZE = 20
// Below this a pitch shift is inaudible - skip the (expensive) rubberband
// node entirely, matching how eqNodeType elsewhere treats a true no-op as
// "skip the node," not "run it at neutral settings."
const IDENTITY_PITCH_EPSILON_SEMITONES = 0.02
// A little slack past the last event's own end so a batch's final shot
// (plus any fade-out tail) isn't clipped by the batch track's own length.
const BATCH_TAIL_MARGIN_SECONDS = 0.25

const INTERMEDIATE_EXT = 'flac'
const INTERMEDIATE_CODEC = ['-c:a', 'flac', '-ar', '44100', '-ac', '2']

// "Faster export" (settings.fasterExport, OFF by default, passed in by the
// export:run handler). When on, the independent short passes - every shot
// bake, every sliced batch - run several at a time instead of sequentially,
// and rubberband uses its faster pitch mode. Hard-capped: a single 20-event
// rubberband batch was measured
// at ~500 MB, and this pipeline has a documented "took all my RAM and never
// finished" bug (v0.1.85), so concurrency is never more than this many
// regardless of core count. OFF ⇒ concurrency 1 (the pre-toggle behavior,
// unchanged).
const FASTER_EXPORT_CONCURRENCY_CAP = 4

// Runs `worker` over `items` with at most `concurrency` in flight at once.
// Preserves the pre-toggle behavior exactly at concurrency 1 (a plain
// sequential walk). Rejects on the first worker error, like Promise.all.
async function mapPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  async function runner() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: limit }, runner))
}

function exportTempDir() {
  return path.join(app.getPath('userData'), 'export-tmp')
}

function tempPath(ext) {
  return path.join(exportTempDir(), `${crypto.randomUUID()}.${ext}`)
}

async function cleanupFiles(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      // best-effort - a leftover temp file isn't worth failing the export over
    }
  }
}

// Progress reporting for the Export tab's bar + verbose log. The rewrite has
// ~1 heavy full-duration pass (the final mix) plus many short ones (the
// sliced batches), so progress is weighted by *audio-seconds to process* -
// the sum of every batch's own span plus one full export duration for the
// final mix - rather than by "number of heavy passes" like the old shape.
// The cheap per-sound shot bakes aren't weighted, just announced via step().
//   { type:'step', label }            - a new phase started
//   { type:'tick', fraction }         - 0..1 across the whole export
function makeReporter(onProgress, totalWorkSeconds) {
  const total = Math.max(1, totalWorkSeconds)
  let doneSeconds = 0
  // Under "Faster export" several phases tick concurrently, so a raw
  // (doneSeconds + f) can briefly read lower than a previous tick when a
  // fresh batch starts. Clamp every reported fraction up to the highest one
  // emitted so far - the bar only ever moves forward.
  let maxFraction = 0
  const emit = (payload) => {
    if (!onProgress) return
    if (typeof payload.fraction === 'number') {
      maxFraction = Math.max(maxFraction, Math.min(1, payload.fraction))
      payload.fraction = maxFraction
    }
    try {
      onProgress(payload)
    } catch {
      // a progress-callback failure must never break the export
    }
  }
  return {
    step(label) {
      emit({ type: 'step', label, fraction: doneSeconds / total })
    },
    // progress within a phase `phaseSeconds` long; several may be running at
    // once under the faster-export toggle
    tick(secIntoPhase, phaseSeconds) {
      const f = Math.min(phaseSeconds, Math.max(0, secIntoPhase || 0))
      emit({ type: 'tick', fraction: Math.min(1, (doneSeconds + f) / total) })
    },
    completePhase(phaseSeconds) {
      doneSeconds += phaseSeconds
      emit({ type: 'tick', fraction: Math.min(1, doneSeconds / total) })
    }
  }
}

// Chronological events -> contiguous batches, each with the real time span it
// occupies (first event's offset .. last event's offset + its own
// pitch-adjusted shot length + a little tail slack). Computed up front from
// the event list alone (no rendering needed) so the progress reporter can be
// weighted before any ffmpeg runs.
function planBatches(events, shotDurationSeconds) {
  const batches = []
  for (let i = 0; i < events.length; i += EVENT_BATCH_SIZE) {
    const slice = events.slice(i, i + EVENT_BATCH_SIZE)
    const start = slice[0].offsetSeconds
    let end = start
    for (const evt of slice) {
      const shotLen = Number.isFinite(evt.shotDurationSeconds) ? evt.shotDurationSeconds : shotDurationSeconds
      end = Math.max(end, evt.offsetSeconds + shotLen + (evt.fadeOutMs ?? 0) / 1000)
    }
    end += BATCH_TAIL_MARGIN_SECONDS
    batches.push({ events: slice, start, span: Math.max(0.05, end - start) })
  }
  return batches
}

// Renders one sound's [loopStart, loopEnd) as a single short FLAC shot clip.
// A loop sound whose already-baked cached clip still matches (cachedClipPath,
// resolved by the IPC handler via library.getLoopClipPathForId) skips the
// bake entirely and reuses that file - returned with owned:false so cleanup
// leaves it alone.
async function bakeShotClip(sound, { forLoop }) {
  if (forLoop && sound.cachedClipPath && fs.existsSync(sound.cachedClipPath)) {
    return { path: sound.cachedClipPath, owned: false }
  }
  const shotPath = tempPath(INTERMEDIATE_EXT)
  const result = await renderClipToPath({
    inputPath: sound.inputPath,
    loopStart: sound.loopStart,
    loopEnd: sound.loopEnd,
    filters: sound.filters,
    // A scatter/scheduled shot is never looped back-to-back, so it's never
    // crossfaded/rotated against itself, and its per-event speed/pitch is
    // applied later, per placement - matching effectiveCrossfadeSeconds'
    // reasoning across the rest of the app.
    crossfadeSeconds: forLoop ? sound.crossfadeSeconds : 0,
    speedPitch: forLoop ? sound.speedPitch : null,
    outputPath: shotPath
  })
  if (!result.ok) {
    await cleanupFiles([shotPath])
    throw new Error(result.error ?? 'shot render failed')
  }
  return { path: shotPath, owned: true }
}

function eventBranchChain(evt, volume, batchStart, speedMode) {
  const semitones = evt.pitchSemitones ?? 0
  const gain = (evt.volumeScale ?? 1) * volume
  const parts = []
  if (Math.abs(semitones) >= IDENTITY_PITCH_EPSILON_SEMITONES) {
    // pitchq=speed: rubberband's fast (slightly lower quality) pitch mode -
    // only under the faster-export toggle, since it's an unexpected quality
    // change, not just a resource one.
    const rb = `rubberband=pitch=${Math.pow(2, semitones / 12).toFixed(6)}`
    parts.push(speedMode ? `${rb}:pitchq=speed` : rb)
  }
  parts.push(`volume=${gain.toFixed(6)}`)
  if (evt.fadeInMs > 0) parts.push(`afade=t=in:d=${(evt.fadeInMs / 1000).toFixed(3)}`)
  if (evt.fadeOutMs > 0 && Number.isFinite(evt.shotDurationSeconds)) {
    const start = Math.max(0, evt.shotDurationSeconds - evt.fadeOutMs / 1000)
    parts.push(`afade=t=out:st=${start.toFixed(3)}:d=${(evt.fadeOutMs / 1000).toFixed(3)}`)
  }
  const delayMs = Math.max(0, Math.round((evt.offsetSeconds - batchStart) * 1000))
  parts.push(`adelay=delays=${delayMs}:all=1`)
  return parts.join(',')
}

// One sliced batch -> its own short FLAC track, plus the absolute offset it
// needs to sit at in the final mix. asplit+per-branch+amix(normalize=0) is
// written to a script file and passed via -filter_complex_script so a dense
// batch can't hit a command-line length limit.
async function renderSlicedBatch({ shotPath, batch, volume, speedMode, reporter }) {
  const trackPath = tempPath(INTERMEDIATE_EXT)
  const scriptPath = tempPath('txt')
  const { events, start, span } = batch
  try {
    const n = events.length
    const splitLabels = events.map((_, i) => `[s${i}]`).join('')
    const parts = [`[0:a]aformat=channel_layouts=stereo,asplit=${n}${splitLabels};`]
    const mixLabels = []
    events.forEach((evt, i) => {
      parts.push(`[s${i}]${eventBranchChain(evt, volume, start, speedMode)}[d${i}];`)
      mixLabels.push(`[d${i}]`)
    })
    parts.push(
      `${mixLabels.join('')}amix=inputs=${n}:duration=longest:dropout_transition=0:normalize=0,` +
        `apad=whole_dur=${span.toFixed(6)}[out]`
    )
    fs.writeFileSync(scriptPath, parts.join(''))

    await runFfmpegToFile(
      [
        '-y', '-i', shotPath,
        '-filter_complex_script', scriptPath,
        '-map', '[out]',
        '-t', span.toFixed(6),
        ...INTERMEDIATE_CODEC, trackPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, span) }
    )
    reporter?.completePhase(span)
    return { path: trackPath, offset: start }
  } finally {
    await cleanupFiles([scriptPath])
  }
}

const FORMAT_CODECS = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-b:a', '192k']
}

// The one heavy pass: every loop shot tiled via -stream_loop through its own
// `volume`, every sliced batch track delayed to its absolute offset, all
// summed (normalize=0), then whole-mix highpass/lowpass/gain and fade in/out
// applied last, then encoded to the chosen format.
async function renderFinalMixdown({
  loopShots,
  batchTracks,
  durationSeconds,
  wholeMixFilters,
  fadeInSeconds,
  fadeOutSeconds,
  outputPath,
  format,
  reporter
}) {
  const inputArgs = []
  const graph = []
  const mixLabels = []
  let idx = 0

  for (const shot of loopShots) {
    inputArgs.push('-stream_loop', '-1', '-i', shot.path)
    graph.push(`[${idx}:a]aformat=channel_layouts=stereo,volume=${shot.volume.toFixed(6)}[m${idx}]`)
    mixLabels.push(`[m${idx}]`)
    idx += 1
  }
  for (const track of batchTracks) {
    inputArgs.push('-i', track.path)
    const delayMs = Math.max(0, Math.round(track.offset * 1000))
    graph.push(`[${idx}:a]aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[m${idx}]`)
    mixLabels.push(`[m${idx}]`)
    idx += 1
  }

  // Nothing ever plays (every sound was a scatter/scheduled one that never
  // fires in this window) - still produce a valid, correctly-long silent
  // file rather than erroring.
  if (idx === 0) {
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    graph.push(`[0:a]anull[m0]`)
    mixLabels.push('[m0]')
    idx = 1
  }

  const post = []
  if (wholeMixFilters?.highpassHz > 0) post.push(`highpass=f=${wholeMixFilters.highpassHz}`)
  if (wholeMixFilters?.lowpassHz > 0 && wholeMixFilters.lowpassHz < 20000) post.push(`lowpass=f=${wholeMixFilters.lowpassHz}`)
  if (wholeMixFilters?.gainDb) post.push(`volume=${wholeMixFilters.gainDb}dB`)
  if (fadeInSeconds > 0) post.push(`afade=t=in:d=${fadeInSeconds.toFixed(3)}`)
  if (fadeOutSeconds > 0) {
    post.push(`afade=t=out:st=${Math.max(0, durationSeconds - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`)
  }

  graph.push(
    `${mixLabels.join('')}amix=inputs=${idx}:duration=longest:dropout_transition=0:normalize=0,` +
      `apad=whole_dur=${durationSeconds.toFixed(6)}${post.length ? `,${post.join(',')}` : ''}[out]`
  )

  const scriptPath = tempPath('txt')
  fs.writeFileSync(scriptPath, graph.join(';'))
  const codecArgs = FORMAT_CODECS[format] ?? FORMAT_CODECS.wav
  try {
    await runFfmpegToFile(
      [
        '-y', ...inputArgs,
        '-filter_complex_script', scriptPath,
        '-map', '[out]',
        '-t', durationSeconds.toFixed(6),
        ...codecArgs, '-ar', '44100', '-ac', '2',
        outputPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
    )
    reporter?.completePhase(durationSeconds)
  } finally {
    await cleanupFiles([scriptPath])
  }
}

// sounds: [{ soundId, inputPath, cachedClipPath, name, playMode, loopStart,
//   loopEnd, filters, speedPitch, crossfadeSeconds, volume, events }] -
//   already fully resolved by the renderer + IPC handler (library lookup,
//   path resolution, event simulation). events is null/empty for 'loop'
//   mode, an array of { offsetSeconds, pitchSemitones, volumeScale,
//   fadeInMs, fadeOutMs, shotDurationSeconds } for 'scatter'/'scheduled'.
export async function exportMix({ sounds, durationSeconds, format, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, onProgress, fasterExport = false }) {
  fs.mkdirSync(exportTempDir(), { recursive: true })
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  // Split sounds into loop vs. event-based, plan every batch up front, and
  // sum the total audio-seconds of work so progress can be weighted.
  const loopSounds = []
  const eventSounds = []
  for (const sound of sounds) {
    if ((sound.playMode ?? 'loop') === 'loop') {
      loopSounds.push(sound)
    } else {
      const events = sound.events ?? []
      if (events.length === 0) continue // never fires in this window - skip entirely
      const shotDur = Math.max(0.05, (sound.loopEnd ?? 0) - (sound.loopStart ?? 0))
      eventSounds.push({ sound, batches: planBatches(events, shotDur) })
    }
  }

  const totalWorkSeconds =
    durationSeconds + eventSounds.reduce((sum, es) => sum + es.batches.reduce((s, b) => s + b.span, 0), 0)
  const reporter = makeReporter(onProgress, totalWorkSeconds)

  if (sounds.length === 0) return { ok: false, error: 'No sounds to export' }

  // "Faster export" toggle: independent short passes (shot bakes, sliced
  // batches) run `concurrency` at a time. OFF ⇒ 1 ⇒ a plain sequential walk,
  // byte-for-byte the pre-toggle pipeline. ON ⇒ bounded by core count and a
  // hard cap - each in-flight batch holds a few hundred MB (measured ~180 MB
  // with the now-span-limited batch graphs), so the CAP keeps peak bounded.
  const concurrency = fasterExport
    ? Math.max(1, Math.min((os.cpus()?.length ?? 2) - 1, FASTER_EXPORT_CONCURRENCY_CAP))
    : 1

  const ownedShotPaths = [] // every owned shot clip - kept alive through the batch phase, cleaned at the very end
  const batchTrackPaths = []
  try {
    if (fasterExport && concurrency > 1) {
      reporter.step(`Faster export on — up to ${concurrency} passes at once.`)
    }

    // Phase 1: bake every shot clip (loop + event sounds). All independent.
    reporter.step('Preparing sound clips…')
    const loopShots = []
    await mapPool(loopSounds, concurrency, async (sound) => {
      const shot = await bakeShotClip(sound, { forLoop: true })
      if (shot.owned) ownedShotPaths.push(shot.path)
      loopShots.push({ path: shot.path, volume: sound.volume ?? 0.7 })
    })

    const eventShotPathBySound = new Map()
    await mapPool(eventSounds, concurrency, async ({ sound }) => {
      const shot = await bakeShotClip(sound, { forLoop: false })
      if (shot.owned) ownedShotPaths.push(shot.path)
      eventShotPathBySound.set(sound, shot.path)
    })

    // Phase 2: render every sliced batch across every event sound. Also all
    // independent (each reads its shot clip read-only, writes its own temp
    // track) - flattened into one job list so the pool stays saturated
    // across sound boundaries.
    const batchJobs = []
    for (const { sound, batches } of eventSounds) {
      const label = `"${sound.name ?? 'sound'}"`
      const plays = `${sound.events.length} play${sound.events.length === 1 ? '' : 's'}`
      batches.forEach((batch, b) => {
        batchJobs.push({
          sound,
          batch,
          shotPath: eventShotPathBySound.get(sound),
          stepLabel:
            batches.length > 1
              ? `Placing ${label}: batch ${b + 1} of ${batches.length}…`
              : `Placing ${label}'s ${plays}…`
        })
      })
    }

    const batchTracks = []
    await mapPool(batchJobs, concurrency, async (job) => {
      reporter.step(job.stepLabel)
      const track = await renderSlicedBatch({
        shotPath: job.shotPath,
        batch: job.batch,
        volume: job.sound.volume ?? 0.7,
        speedMode: fasterExport,
        reporter
      })
      batchTrackPaths.push(track.path)
      batchTracks.push(track)
    })

    reporter.step('Final mixdown + whole-mix processing…')
    await renderFinalMixdown({
      loopShots,
      batchTracks,
      durationSeconds,
      wholeMixFilters,
      fadeInSeconds,
      fadeOutSeconds,
      outputPath,
      format,
      reporter
    })
    reporter.step(`Encoding to ${String(format || 'wav').toUpperCase()} — done.`)
    return { ok: true }
  } catch (err) {
    console.error('exportMix failed', err)
    return { ok: false, error: err.message }
  } finally {
    await cleanupFiles([...ownedShotPaths, ...batchTrackPaths])
  }
}
