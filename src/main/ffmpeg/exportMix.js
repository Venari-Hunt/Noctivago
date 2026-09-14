import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { runFfmpegToFile } from './runFfmpeg.js'
import { renderClipToPath, buildEqBandFilter, eqBandStageCount, buildEchoFilter, applyReverbPass } from './loopClip.js'
import { renderGainEnvelopeWav, hasVolumeFluctuation } from './gainEnvelope.js'
import { renderPitchCommandFile, pitchCommandFilter, hasPitchFluctuation } from './pitchEnvelope.js'
import { resolveFfmpegPath } from './ffmpegPath.js'
import { renderVisualizationVideo } from './visualizationVideo.js'
import { renderImageLoopVideo } from './imageLoopVideo.js'
import { applyOcclusionToFilters } from '../../shared/constants.js'

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
// regardless, UNLESS `parallelMixdown` (Export Part B, a second/separate
// opt-in toggle) is also on - see tileLoopShotFull/renderFinalMixFromTracks
// below for why and how step 3 itself gets split into independent
// per-loop-sound passes in that case.

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
// When a sound's shots need NO rubberband at all - no per-shot pitch AND no
// per-shot speed variation (see eventsNeedRubberband) - each event branch is
// just volume + fade + adelay, which is cheap enough to pack far more of
// into one graph. A dense Random Interval sound with plain shots then
// produces ~15x fewer batch tracks, which is what actually collapses the
// "Merging N track groups" phase on a long export (measured: a batch of 300
// plain branches over a 20-min span peaks ~270 MB, one ffmpeg pass ~90s).
const EVENT_BATCH_SIZE_LIGHT = 300
// Below this a pitch shift is inaudible - skip the (expensive) rubberband
// node entirely, matching how eqNodeType elsewhere treats a true no-op as
// "skip the node," not "run it at neutral settings."
const IDENTITY_PITCH_EPSILON_SEMITONES = 0.02
// Below this a per-shot speed factor is inaudible (mirrors
// pitchStretch.js's IDENTITY_SPEED_EPSILON) - a batch of shots all within
// this of 1.0x, with no pitch variation either, needs no rubberband.
const IDENTITY_SPEED_EPSILON = 0.005
// A little slack past the last event's own end so a batch's final shot
// (plus any fade-out tail) isn't clipped by the batch track's own length.
const BATCH_TAIL_MARGIN_SECONDS = 0.25

const INTERMEDIATE_EXT = 'flac'
const INTERMEDIATE_CODEC = ['-c:a', 'flac', '-ar', '44100', '-ac', '2']

// Windows caps a process command line at ~32,767 characters, and every
// "-i <temp path>" pair is ~95 of them. The final mixdown - and any combine
// pass - takes one input per piece it merges, so a big export (long
// duration, or a Random Interval / Scheduled sound firing very often) can
// produce enough sliced-batch tracks to blow that limit outright (reported:
// "Export failed: spawn ENAMETOOLONG"). Keep every pass's input count under
// this by pre-combining batch tracks in rounds before the final mixdown.
// 128 * ~100 chars = ~13 KB of command line, still a comfortable margin
// under the ~32,767 limit even with a long user profile path; a combine
// pass is just adelay + amix (no rubberband), so a wide one stays cheap and
// can't hit the v0.1.85 memory blowup. Raised from 32 (v0.1.136) so a dense
// export whose batch tracks were already thinned by EVENT_BATCH_SIZE_LIGHT
// usually skips the pre-combine ("Merging N track groups") round entirely.
const MAX_INPUTS_PER_PASS = 128

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
// sequential walk). On the first worker error every runner stops pulling new
// items, but the pool still waits for the (at most `concurrency`-1) already
// in-flight workers to settle before rethrowing - otherwise those stragglers
// would keep spawning ffmpeg after exportMix has already returned failure,
// and their temp paths would land in the cleanup arrays *after* the finally
// block already ran (a real leak under "Faster export").
async function mapPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  let firstError = null
  async function runner() {
    while (firstError === null) {
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch (err) {
        if (firstError === null) firstError = err
        return
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, runner))
  if (firstError) throw firstError
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

// Reported directly ("temporary export files are taking up some space...
// verify if the cleanup after export should be more agile"). Every write
// path into export-tmp (this file's own cleanupFiles calls, ipc.js's
// Composite bake) is careful to remove its own files via try/finally on
// every controlled exit - but none of that runs if the whole process dies
// mid-export instead of unwinding normally (force-quit, a crash, Windows
// forcing a restart, a laptop losing power) - a real, ordinary way for a
// multi-hour export's intermediates (which can be sizeable: per-batch
// tracks, full-duration tiled loop renders, group buses) to survive past
// the run that created them with nothing left to ever clean them up.
// Anything still in export-tmp at the *next* launch is guaranteed orphaned
// - no export or Composite bake can span an app restart - so a full sweep
// on startup is always safe, mirroring presetPortable.js's own
// sweepImportSessions() for the exact same reason.
export function sweepExportTempDir() {
  try {
    fs.rmSync(exportTempDir(), { recursive: true, force: true })
  } catch {
    // best-effort
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
// True if any event in the list needs a rubberband pass (per-shot pitch or
// per-shot speed differs from neutral) - the same test eventBranchChain
// applies per event. A sound where this is false gets the big
// EVENT_BATCH_SIZE_LIGHT batches, since its branches are only volume/fade/
// adelay.
function eventsNeedRubberband(events) {
  return events.some(
    (e) =>
      Math.abs(e.pitchSemitones ?? 0) >= IDENTITY_PITCH_EPSILON_SEMITONES ||
      Math.abs((e.speedFactor ?? 1) - 1) >= IDENTITY_SPEED_EPSILON
  )
}

function planBatches(events, shotDurationSeconds, batchSize = EVENT_BATCH_SIZE) {
  const batches = []
  for (let i = 0; i < events.length; i += batchSize) {
    const slice = events.slice(i, i + batchSize)
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
  // renderClipToPath always writes uncompressed pcm_s16le WAV regardless of
  // the path's extension, so name it .wav honestly rather than .flac. (Only
  // the sliced-batch tracks below, written via INTERMEDIATE_CODEC, are
  // actually FLAC - that's where the temp-I/O saving is.)
  const shotPath = tempPath('wav')
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
  const speedFactor = evt.speedFactor ?? 1
  const gain = (evt.volumeScale ?? 1) * volume
  const parts = []
  const pitchActive = Math.abs(semitones) >= IDENTITY_PITCH_EPSILON_SEMITONES
  const speedActive = Math.abs(speedFactor - 1) >= IDENTITY_SPEED_EPSILON
  if (pitchActive || speedActive) {
    // One rubberband pass handles both: `pitch` shifts pitch without
    // touching length (per-shot Pitch range, v0.1.111), `tempo` changes
    // length/tempo without touching pitch (per-shot Speed range). tempo>1 =
    // faster/shorter. pitchq=speed is rubberband's fast (slightly lower
    // quality) mode - only under the faster-export toggle, an unexpected
    // quality change rather than just a resource one.
    const rbParts = []
    if (pitchActive) rbParts.push(`pitch=${Math.pow(2, semitones / 12).toFixed(6)}`)
    if (speedActive) rbParts.push(`tempo=${speedFactor.toFixed(6)}`)
    if (speedMode) rbParts.push('pitchq=speed')
    parts.push(`rubberband=${rbParts.join(':')}`)
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

// adelay every track to its absolute offset, then amix (honest sum,
// normalize=0 - matching the rest of the pipeline). One ffmpeg pass, graph
// via -filter_complex_script so the graph itself never touches the command
// line. Returns one track, now absolute-positioned (offset 0).
// BUG FIX (inbox 2026-09-14: a "fail log" pasted after an export sat on
// "Merging 243 track groups…" for 37 real minutes with the progress bar
// frozen solid): this amix pass runs real, potentially very long ffmpeg work
// - exactly the class of bug already fixed twice elsewhere in this file for
// the video re-encode and Sound Group passes (see their own "Percentage is
// stuck" comments) - but never had onProgress wired at all, so the reporter
// heard nothing until the whole pass was done. durationSeconds is a rough
// upper bound (every track combined here is bounded by the export length,
// same spirit as groupWorkSeconds' own estimate below), just enough to keep
// the bar visibly moving instead of stalling.
async function combineTracks(tracks, { durationSeconds, reporter } = {}) {
  const outPath = tempPath(INTERMEDIATE_EXT)
  const scriptPath = tempPath('txt')
  const graph = []
  const mixLabels = []
  tracks.forEach((t, i) => {
    const delayMs = Math.max(0, Math.round(t.offset * 1000))
    graph.push(`[${i}:a]aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[m${i}]`)
    mixLabels.push(`[m${i}]`)
  })
  graph.push(
    `${mixLabels.join('')}amix=inputs=${tracks.length}:duration=longest:dropout_transition=0:normalize=0[out]`
  )
  fs.writeFileSync(scriptPath, graph.join(';'))
  try {
    await runFfmpegToFile(
      [
        '-y',
        ...tracks.flatMap((t) => ['-i', t.path]),
        '-filter_complex_script', scriptPath,
        '-map', '[out]',
        ...INTERMEDIATE_CODEC, outPath
      ],
      durationSeconds ? { onProgress: (sec) => reporter?.tick(sec, durationSeconds) } : undefined
    )
    return { path: outPath, offset: 0 }
  } finally {
    await cleanupFiles([scriptPath])
  }
}

// Reduce `tracks` to at most `target` entries by combining them in
// fixed-size chunks, repeatedly, until few enough remain to hand the final
// mixdown without overflowing the command line. Every intermediate created
// is pushed onto `ownPaths` for end-of-export cleanup.
//
// The chunk combines within one round are fully independent (each reads a
// disjoint slice, writes its own temp file), so they run `concurrency` at a
// time via mapPool - on a long dense export this "Merging N track groups"
// phase was measured as the single biggest chunk of wall-clock time
// (v0.1.136), and it was the one place still walking its passes one by one
// while every other phase already parallelized under Faster export /
// Parallel mixdown. concurrency 1 keeps the old exact sequential behavior.
async function reduceTrackCount(tracks, target, ownPaths, reporter, concurrency = 1, durationSeconds = null) {
  let current = tracks
  while (current.length > target) {
    reporter?.step(`Merging ${current.length} track groups…`)
    const chunks = []
    for (let i = 0; i < current.length; i += MAX_INPUTS_PER_PASS) {
      chunks.push(current.slice(i, i + MAX_INPUTS_PER_PASS))
    }
    const nextRound = new Array(chunks.length)
    await mapPool(chunks, concurrency, async (chunk, idx) => {
      if (chunk.length === 1) {
        nextRound[idx] = chunk[0]
        return
      }
      const combined = await combineTracks(chunk, { durationSeconds, reporter })
      ownPaths.push(combined.path)
      nextRound[idx] = combined
    })
    current = nextRound
  }
  return current
}

// PARALLEL MIXDOWN (opt-in, `parallelMixdown` - Export Part B). The
// 2026-09-02 research pass found the final mixdown is the one remaining
// serial bottleneck: ffmpeg's audio filtergraph runs on one thread, so N
// loop-mode sounds each tiled for the *whole* export duration inside one
// shared renderFinalMixdown pass costs N x duration of serial processing,
// even though those N tilings are fully independent of each other.
// The shape first floated to the owner was literal time-chunking (split the
// timeline into pieces, render each in parallel, concat) - but that only
// pays off for a *stateless* per-sample operation; a loop shot's `-stream_
// loop -1` input can't be seeked into an arbitrary chunk without ffmpeg
// re-decoding everything before it, so time-chunking wouldn't actually
// speed up the layer the research identified as the real cost, and it adds
// a genuine seam-artifact risk at every chunk boundary.
// This instead parallelizes by SOUND: each loop sound's full-duration tile
// becomes its OWN ffmpeg process (tileLoopShotFull), several running at once
// via mapPool - directly parallelizing the N-independent-tilings bottleneck
// with zero seam risk (every sound's own track is still one continuous
// render, no time-domain split anywhere). renderFinalMixFromTracks is then
// a cheap tail: adelay+amix the pre-tiled tracks (loop + batch, same shape),
// apply whole-mix post-processing/fades last, encode - no per-sound tiling
// left to do in that final pass regardless of export length.
// Real cost of this trade: one full-duration intermediate file per loop
// sound gets written to temp disk (previously loop shots were tiled inline,
// never materialized past their short shot length) - more temp I/O/space on
// a long export with several loop layers, cleaned up like every other
// intermediate here.
async function tileLoopShotFull({ shot, durationSeconds, reporter }) {
  const outPath = tempPath(INTERMEDIATE_EXT)
  await runFfmpegToFile(
    [
      '-y', '-stream_loop', '-1', '-i', shot.path,
      '-af', `volume=${shot.volume.toFixed(6)}`,
      '-t', durationSeconds.toFixed(6),
      ...INTERMEDIATE_CODEC, outPath
    ],
    { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
  )
  reporter?.completePhase(durationSeconds)
  return { path: outPath, offset: 0 }
}

// Fluctuation baking (v0.1.171): multiplies one already-materialized,
// full-duration, offset-0 track by a rendered volume-drift control signal
// (see gainEnvelope.js) via ffmpeg's `amultiply`, producing a new offset-0
// track that drops into the mix like any other. Used for a fluctuating loop
// sound's own tiled track, a Sound Group's submix bus, and (folded into
// finalizeWholeMix, not here) the whole final mix. The envelope is
// generated at 1000 Hz and `aresample`d up to the mix rate here; both
// streams are forced to stereo fltp so amultiply never hits a format/
// channel/rate mismatch. Since fluctuation is attenuation-only (values
// 0..1), applying it after a track's own limiter - which is where a group
// bus / whole mix ends up - can't introduce clipping, so the exact node
// position (live: before the limiter) doesn't matter for the bake.
async function applyEnvelopeToTrack(track, fluctuation, durationSeconds, reporter) {
  const envPath = renderGainEnvelopeWav(fluctuation, durationSeconds)
  if (!envPath) return track
  const outPath = tempPath(INTERMEDIATE_EXT)
  try {
    await runFfmpegToFile(
      [
        '-y', '-i', track.path, '-i', envPath,
        '-filter_complex',
        '[1:a]aresample=44100,aformat=channel_layouts=stereo:sample_fmts=fltp[env];' +
          '[0:a]aformat=channel_layouts=stereo:sample_fmts=fltp[sig];' +
          '[sig][env]amultiply[out]',
        '-map', '[out]',
        '-t', durationSeconds.toFixed(6),
        ...INTERMEDIATE_CODEC, outPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
    )
    reporter?.completePhase(durationSeconds)
    return { path: outPath, offset: 0 }
  } finally {
    await cleanupFiles([envPath])
  }
}

// Pitch Fluctuation baking (v0.1.179): the companion to applyEnvelopeToTrack
// for the pitch axis. Renders one realization of the sound's pitch drift to
// an `asendcmd` command file (see pitchEnvelope.js) and runs the already-
// materialized, full-duration, offset-0 track through `rubberband` with that
// file stepping the pitch scale factor over time - length-preserving, so the
// result drops back into the mix like any other offset-0 track. Per-sound
// only (a bus has nothing single to detune). A no-op returning the same track
// when the config isn't active.
async function applyPitchEnvelopeToTrack(track, fluctuation, durationSeconds, reporter) {
  const cmdPath = renderPitchCommandFile(fluctuation, durationSeconds)
  if (!cmdPath) return track
  const outPath = tempPath(INTERMEDIATE_EXT)
  try {
    await runFfmpegToFile(
      [
        '-y', '-i', track.path,
        '-af', pitchCommandFilter(cmdPath),
        '-t', durationSeconds.toFixed(6),
        ...INTERMEDIATE_CODEC, outPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
    )
    reporter?.completePhase(durationSeconds)
    return { path: outPath, offset: 0 }
  } finally {
    await cleanupFiles([cmdPath])
  }
}

// A loop sound's own per-sound Fluctuation, applied to its full-duration
// tiled track in the same order the live signal chain uses: pitch (detune,
// ahead of everything) then volume (fluctuationGain). Either axis may be
// inactive; returns the (possibly unchanged) track plus any new intermediate
// paths for the caller to clean up.
async function applyLoopFluctuation(tile, fluctuation, durationSeconds, reporter) {
  const newPaths = []
  let track = tile
  if (hasPitchFluctuation(fluctuation)) {
    track = await applyPitchEnvelopeToTrack(track, fluctuation, durationSeconds, reporter)
    newPaths.push(track.path)
  }
  if (hasVolumeFluctuation(fluctuation)) {
    track = await applyEnvelopeToTrack(track, fluctuation, durationSeconds, reporter)
    newPaths.push(track.path)
  }
  return { track, newPaths }
}

// True when a loop sound needs pulling off renderFinalMixdown's cheap
// -stream_loop path onto a materialized full-duration track (either drift axis).
function hasLoopFluctuation(fluctuation) {
  return hasVolumeFluctuation(fluctuation) || hasPitchFluctuation(fluctuation)
}

// Sound Groups (see AudioEngine.js's SoundGroupChain, and the Remix tab's
// Group mode / the Mixer's right-click "Add to group…") - BUG FIX (reported
// directly, "fix ASAP"): a group's own highpass/lowpass/EQ/gain sounds
// exactly right live but had zero effect on an export, since exportMix.js
// never knew groups existed at all (only a preset's own whole-mix filters,
// see buildWholeMixPostChain below, which predates Sound Groups). Mirrors
// SoundGroupChain's own node order (highpass -> lowpass -> eq bands ->
// gain -> limiter) and, like the live chain, always ends in the same
// brick-wall limiter regardless of whether the group boosts anything -
// several loud member sounds honestly summed together can genuinely clip
// with nothing else capping them.
// skipLimiter is used when a reverb pass will run right after this chain -
// applyReverbPass already bakes its own brick-wall limiter into its output,
// so the pre-reverb chain would otherwise be limited twice (harmless
// numerically, since limiting an already-limited signal at the same ceiling
// is a near no-op, but pointless work and a confusing thing to read).
function buildGroupFilterChain(filters, { skipLimiter = false } = {}) {
  const chain = []
  const f = filters ?? {}
  if ((f.highpassHz ?? 0) > 0) chain.push(`highpass=f=${f.highpassHz}`)
  if ((f.lowpassHz ?? 20000) > 0 && (f.lowpassHz ?? 20000) < 20000) chain.push(`lowpass=f=${f.lowpassHz}`)
  for (const band of f.eq ?? []) {
    const bandFilter = buildEqBandFilter(band)
    if (bandFilter) {
      for (let stage = 0; stage < eqBandStageCount(band); stage++) chain.push(bandFilter)
    }
  }
  if (f.gainDb) chain.push(`volume=${f.gainDb}dB`)
  // Echo (2026-09-06, the owner's own "Echo delay is NOT single-sound-
  // specific" direction) - same guard as loopClip.js's own per-sound
  // buildFilterChain, ordered last (post-EQ/gain) to match SoundGroupChain's
  // live parallel echo tap, which reads off the already-EQ'd/gained signal.
  if (f.echoDelayMs > 0 && f.echoDecay > 0) chain.push(buildEchoFilter(f.echoDelayMs, f.echoDecay))
  if (!skipLimiter) chain.push('alimiter=limit=0.95:level=disabled')
  return chain
}

// Applies one group's filter chain to its already-combined (single,
// offset-0, full-duration) submix track, producing a new track that's ready
// to drop straight into the outer final mix like any other pre-rendered
// track. Reverb (2026-09-06, same "not single-sound-specific" direction as
// Echo) needs its own isolated pass - afir needs a second ffmpeg *input*
// (the impulse response), which can't join this plain comma -af chain, so
// it can't just be one more fragment in buildGroupFilterChain the way HP/LP/
// EQ/Gain/Echo can. Mirrors loopClip.js's own per-sound doRender/
// applyReverbPass split: render everything up to (not including) the
// limiter to a WAV intermediate, then run the real reverb pass on it (which
// bakes its own limiter into its output) - skipped entirely, byte-path
// unchanged, whenever the group has no reverb set.
async function applyGroupFilters(track, filters, durationSeconds, reporter) {
  // Occlusion (v0.1.182) folded into the effective lowpass/reverb values
  // here, mirroring SoundGroupChain.js's live chain exactly (same shared
  // helper) - see src/shared/constants.js's applyOcclusionToFilters.
  const f = applyOcclusionToFilters(filters)
  const hasReverb = (f.reverbSizeMs ?? 0) > 0 && (f.reverbMix ?? 0) > 0
  if (!hasReverb) {
    const outPath = tempPath(INTERMEDIATE_EXT)
    await runFfmpegToFile(
      [
        '-y', '-i', track.path,
        '-af', buildGroupFilterChain(f).join(','),
        '-t', durationSeconds.toFixed(6),
        ...INTERMEDIATE_CODEC, outPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
    )
    reporter?.completePhase(durationSeconds)
    return { path: outPath, offset: 0 }
  }

  const preReverbPath = tempPath('wav')
  const outPath = tempPath('wav')
  // A group with only Reverb set (no HP/LP/EQ/Gain/Echo) has a genuinely
  // empty pre-reverb chain (skipLimiter drops the one fragment that would
  // otherwise always be there) - '-af' with an empty filter string is an
  // invalid ffmpeg argument ("No filters specified in the graph
  // description"), so it's omitted entirely rather than passed empty.
  const preReverbChain = buildGroupFilterChain(f, { skipLimiter: true })
  try {
    await runFfmpegToFile([
      '-y', '-i', track.path,
      ...(preReverbChain.length ? ['-af', preReverbChain.join(',')] : []),
      '-t', durationSeconds.toFixed(6),
      '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', preReverbPath
    ])
    await applyReverbPass(preReverbPath, outPath, f.reverbSizeMs, f.reverbMix)
    reporter?.completePhase(durationSeconds)
    return { path: outPath, offset: 0 }
  } finally {
    await cleanupFiles([preReverbPath])
  }
}

// Partitions every loop shot / batch track by which Sound Group (if any) its
// own sound belongs to, renders one fully-mixed-and-filtered submix per
// group actually in use, and hands back the remaining ungrouped tracks
// alongside those group buses - which the caller then treats exactly like
// any other pre-rendered track (offset 0, no further per-group processing
// needed). A grouped loop-mode sound is tiled to its full duration first
// (tileLoopShotFull, independent of the parallelMixdown toggle - a group
// submix needs real audio to combine, not a `-stream_loop` shorthand only
// the single-sound final mixdown can use). Zero groups in use (the common
// case - most exports have none) is a fast no-op: no ffmpeg call at all,
// and the returned arrays are byte-identical to the input, matching this
// pipeline's own "a plain export is untouched" guarantee.
async function renderGroupBuses({ loopShots, batchTracks, groups, durationSeconds, reporter, concurrency, ownPaths }) {
  const groupsById = new Map((groups ?? []).map((g) => [g.id, g]))
  const loopShotsByGroup = new Map()
  const ungroupedLoopShots = []
  for (const shot of loopShots) {
    if (shot.groupId && groupsById.has(shot.groupId)) {
      if (!loopShotsByGroup.has(shot.groupId)) loopShotsByGroup.set(shot.groupId, [])
      loopShotsByGroup.get(shot.groupId).push(shot)
    } else {
      ungroupedLoopShots.push(shot)
    }
  }
  const batchTracksByGroup = new Map()
  const ungroupedBatchTracks = []
  for (const track of batchTracks) {
    if (track.groupId && groupsById.has(track.groupId)) {
      if (!batchTracksByGroup.has(track.groupId)) batchTracksByGroup.set(track.groupId, [])
      batchTracksByGroup.get(track.groupId).push(track)
    } else {
      ungroupedBatchTracks.push(track)
    }
  }

  const groupIds = [...new Set([...loopShotsByGroup.keys(), ...batchTracksByGroup.keys()])]
  const groupBusTracks = []
  if (groupIds.length > 0) {
    reporter?.step(`Applying Sound Group processing (${groupIds.length} group${groupIds.length === 1 ? '' : 's'})…`)
    await mapPool(groupIds, concurrency, async (groupId) => {
      const memberLoopShots = loopShotsByGroup.get(groupId) ?? []
      const memberBatchTracks = batchTracksByGroup.get(groupId) ?? []

      const tiledLoops = []
      for (const shot of memberLoopShots) {
        const tile = await tileLoopShotFull({ shot, durationSeconds, reporter })
        ownPaths.push(tile.path)
        // Per-sound Fluctuation on a grouped loop sound: apply the sound's own
        // pitch + volume drift to its tiled track *before* it's combined into
        // the group submix, matching the live signal order (a sound's own
        // detune / fluctuationGain sit ahead of its Sound Group routing).
        const { track: drifted, newPaths } = await applyLoopFluctuation(
          tile, shot.fluctuation, durationSeconds, reporter
        )
        ownPaths.push(...newPaths)
        tiledLoops.push(drifted)
      }

      const memberTracks = [...tiledLoops, ...memberBatchTracks]
      const bounded =
        memberTracks.length > MAX_INPUTS_PER_PASS
          ? await reduceTrackCount(memberTracks, MAX_INPUTS_PER_PASS, ownPaths, reporter, concurrency, durationSeconds)
          : memberTracks
      // combineTracks always adelays every track to its real offset and
      // normalizes the result to offset 0 - needed even for a single
      // already-offset-0 track's worth of member, since a lone batch track
      // (offset = its own batch start, not 0) would otherwise silently keep
      // playing from the wrong position once treated as a pre-mixed,
      // offset-0 group bus. Skipped only when there's genuinely nothing left
      // to combine (a single track that's already offset 0).
      const combined =
        bounded.length === 1 && bounded[0].offset === 0
          ? bounded[0]
          : await combineTracks(bounded, { durationSeconds, reporter })
      if (combined !== bounded[0]) ownPaths.push(combined.path)
      // groupWorkSeconds (exportMix's own progress budget) already reserves
      // one durationSeconds' worth of work per group for exactly this combine
      // step - mark it spent here (flat, same as the budget itself is flat)
      // so the bar actually reflects that reserved chunk instead of leaving
      // it permanently un-banked while combineTracks's own ticks (above) do
      // the moment-to-moment moving.
      reporter?.completePhase(durationSeconds)

      const groupFilters = groupsById.get(groupId)?.filters
      let bus = await applyGroupFilters(combined, groupFilters, durationSeconds, reporter)
      ownPaths.push(bus.path)
      // The group's own volume Fluctuation (Remix Group mode) - the whole
      // bus drifting, applied after its filter/limiter chain (attenuation
      // only, so post-limiter is safe - see applyEnvelopeToTrack).
      if (hasVolumeFluctuation(groupFilters?.fluctuation)) {
        bus = await applyEnvelopeToTrack(bus, groupFilters.fluctuation, durationSeconds, reporter)
        ownPaths.push(bus.path)
      }
      groupBusTracks.push(bus)
    })
  }

  return {
    ungroupedLoopShots,
    tracksForFinalMix: [...ungroupedBatchTracks, ...groupBusTracks]
  }
}

// Builds the whole-mix post-processing filter chain fragment, matching
// WholeMixChain.js's own live node order (highpass -> lowpass -> eq bands ->
// gain -> fade) so a preset's Preset Remix settings (2026-09-02: exportMix.js
// now inherits a preset's own wholeMix, applied last, over the whole export -
// see the plugins/export/index.js call site) sound the same baked into an
// export as they do live in the Mixer. Reuses loopClip.js's
// buildEqBandFilter/eqBandStageCount directly for the eq bands - same
// directory, no plugin-boundary duplication needed.
// NOT inherited on purpose: wholeMix.fadeInSeconds (Preset Remix's own
// "fade the live mix in when this preset loads" setting) - a different
// concept from the fadeInSeconds/fadeOutSeconds params here, which are the
// Export tab's own start/end fade for the whole rendered file. Only
// highpass/lowpass/gain/eq are shared between live and export.
// True whenever a whole-mix config's Reverb is actually active - shared by
// finalizeWholeMix (below) and plugins/export/index.js's own progress-budget
// estimate.
function wholeMixHasReverb(wholeMixFilters) {
  return (wholeMixFilters?.reverbSizeMs ?? 0) > 0 && (wholeMixFilters?.reverbMix ?? 0) > 0
}

// includeLimiter=false when Reverb is active (its own isolated pass, see
// finalizeWholeMix, already bakes a brick-wall limiter into its output).
// includeTail=false whenever a later pass runs (Reverb, or whole-mix volume
// Fluctuation) - the start/end fades have to be the very last thing done to
// the file, so they move to that final pass. Both true (the default, and
// the only path when neither Reverb nor Fluctuation is set) keeps this
// function's original single-pass behavior exactly, byte-path unchanged.
function buildWholeMixPostChain({ wholeMixFilters, durationSeconds, fadeInSeconds, fadeOutSeconds, includeLimiter = true, includeTail = true }) {
  const post = []
  if (wholeMixFilters?.highpassHz > 0) post.push(`highpass=f=${wholeMixFilters.highpassHz}`)
  if (wholeMixFilters?.lowpassHz > 0 && wholeMixFilters.lowpassHz < 20000) post.push(`lowpass=f=${wholeMixFilters.lowpassHz}`)
  for (const band of wholeMixFilters?.eq ?? []) {
    const bandFilter = buildEqBandFilter(band)
    if (bandFilter) {
      for (let stage = 0; stage < eqBandStageCount(band); stage++) post.push(bandFilter)
    }
  }
  if (wholeMixFilters?.gainDb) post.push(`volume=${wholeMixFilters.gainDb}dB`)
  // Echo (2026-09-06, the owner's own "Echo delay is NOT single-sound-
  // specific" direction) - same guard/ordering as buildGroupFilterChain's
  // identical addition just above.
  if (wholeMixFilters?.echoDelayMs > 0 && wholeMixFilters?.echoDecay > 0) {
    post.push(buildEchoFilter(wholeMixFilters.echoDelayMs, wholeMixFilters.echoDecay))
  }
  // Brick-wall safety limiter whenever whole-mix processing is doing anything -
  // its gain and EQ bands have no other ceiling (same exposure Composite's bake
  // had before v0.1.113). Matches the live WholeMixChain limiter so an export
  // sounds like the Mixer. Only reached when whole-mix settings exist; a plain
  // export leaves `post` empty and is untouched (keeps the blessed export
  // loudness, see the noctivago_feel_verdicts note).
  if (includeLimiter && post.length > 0) post.push('alimiter=limit=0.95:level=disabled')
  if (includeTail) post.push(...buildWholeMixTailChain({ durationSeconds, fadeInSeconds, fadeOutSeconds }))
  return post
}

// Fade in/out only - split out of buildWholeMixPostChain so the reverb path
// can apply these *after* its own pass instead of before it (a fade has to
// be the very last thing that happens to the file, same as it always was).
function buildWholeMixTailChain({ durationSeconds, fadeInSeconds, fadeOutSeconds }) {
  const tail = []
  if (fadeInSeconds > 0) tail.push(`afade=t=in:d=${fadeInSeconds.toFixed(3)}`)
  if (fadeOutSeconds > 0) {
    tail.push(`afade=t=out:st=${Math.max(0, durationSeconds - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`)
  }
  return tail
}

// Shared tail for renderFinalMixdown/renderFinalMixFromTracks - both build
// their own `inputArgs`/`graph`/`mixLabels`/`idx` (the only real difference
// between them: loop-shot -stream_loop tiling vs. already-pre-tiled tracks),
// then hand off here for "apply whole-mix processing, encode" - previously
// duplicated in both, which would have meant writing the Reverb / Fluctuation
// isolated-pass logic below twice.
//
// Reverb (afir) and whole-mix volume Fluctuation (v0.1.171) both need a
// pass *after* the main filtergraph, so when either is active the main graph
// renders to a WAV intermediate instead of straight to the output file:
//   main graph -> [reverb pass, if any] -> [envelope multiply, if any] +
//   start/end fades + real format encode.
// The main graph keeps its own limiter unless Reverb is active (applyReverb
// Pass bakes its own); the fades always move to the final pass so they stay
// dead last. Skipped entirely, single-pass, byte-path unchanged when neither
// is set - matches the "blessed export loudness" guarantee every other
// whole-mix addition here has kept.
async function finalizeWholeMix({ inputArgs, graph, mixLabels, idx, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format, reporter }) {
  const hasReverb = wholeMixHasReverb(wholeMixFilters)
  const hasFluct = hasVolumeFluctuation(wholeMixFilters?.fluctuation)
  const needsIntermediate = hasReverb || hasFluct
  const post = buildWholeMixPostChain({
    wholeMixFilters,
    durationSeconds,
    fadeInSeconds,
    fadeOutSeconds,
    includeLimiter: !hasReverb,
    includeTail: !needsIntermediate
  })
  graph.push(
    `${mixLabels.join('')}amix=inputs=${idx}:duration=longest:dropout_transition=0:normalize=0,` +
      `apad=whole_dur=${durationSeconds.toFixed(6)}${post.length ? `,${post.join(',')}` : ''}[out]`
  )

  const scriptPath = tempPath('txt')
  fs.writeFileSync(scriptPath, graph.join(';'))
  const mainWavPath = needsIntermediate ? tempPath('wav') : null
  const targetPath = needsIntermediate ? mainWavPath : outputPath
  const targetCodecArgs = needsIntermediate ? ['-c:a', 'pcm_s16le'] : (FORMAT_CODECS[format] ?? FORMAT_CODECS.wav)
  const targetSampleRate = needsIntermediate ? 44100 : outputSampleRate(format)
  const toCleanup = [scriptPath]
  try {
    await runFfmpegToFile(
      [
        '-y', ...inputArgs,
        '-filter_complex_script', scriptPath,
        '-map', '[out]',
        '-t', durationSeconds.toFixed(6),
        ...targetCodecArgs, '-ar', String(targetSampleRate), '-ac', '2',
        targetPath
      ],
      { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
    )
    if (!needsIntermediate) {
      reporter?.completePhase(durationSeconds)
      return
    }

    let stageInPath = mainWavPath
    if (hasReverb) {
      const reverbWetPath = tempPath('wav')
      toCleanup.push(reverbWetPath)
      await applyReverbPass(stageInPath, reverbWetPath, wholeMixFilters.reverbSizeMs, wholeMixFilters.reverbMix)
      stageInPath = reverbWetPath
    }

    const tail = buildWholeMixTailChain({ durationSeconds, fadeInSeconds, fadeOutSeconds })
    const codecArgs = FORMAT_CODECS[format] ?? FORMAT_CODECS.wav
    if (hasFluct) {
      const envPath = renderGainEnvelopeWav(wholeMixFilters.fluctuation, durationSeconds)
      toCleanup.push(envPath)
      const filterComplex =
        '[1:a]aresample=44100,aformat=channel_layouts=stereo:sample_fmts=fltp[env];' +
        '[0:a]aformat=channel_layouts=stereo:sample_fmts=fltp[sig];' +
        `[sig][env]amultiply${tail.length ? `,${tail.join(',')}` : ''}[out]`
      await runFfmpegToFile([
        '-y', '-i', stageInPath, '-i', envPath,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-t', durationSeconds.toFixed(6),
        ...codecArgs, '-ar', String(outputSampleRate(format)), '-ac', '2',
        outputPath
      ])
    } else {
      await runFfmpegToFile([
        '-y', '-i', stageInPath,
        ...(tail.length ? ['-af', tail.join(',')] : []),
        '-t', durationSeconds.toFixed(6),
        ...codecArgs, '-ar', String(outputSampleRate(format)), '-ac', '2',
        outputPath
      ])
    }
    reporter?.completePhase(durationSeconds)
  } finally {
    await cleanupFiles(mainWavPath ? [...toCleanup, mainWavPath] : toCleanup)
  }
}

// The lightweight tail once every track (pre-tiled loop tracks at offset 0 +
// sliced batch tracks at their own offsets, already reduced under
// MAX_INPUTS_PER_PASS) is ready: adelay each to its offset, amix, then
// finalizeWholeMix applies whole-mix processing + fades and encodes.
// Mirrors renderFinalMixdown's own track-gathering shape exactly, minus the
// -stream_loop tiling this version doesn't need to do inline anymore.
async function renderFinalMixFromTracks({ tracks, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format, reporter }) {
  const graph = []
  const mixLabels = []
  let idx = tracks.length

  if (idx === 0) {
    graph.push('[0:a]anull[m0]')
    mixLabels.push('[m0]')
    idx = 1
  } else {
    tracks.forEach((t, i) => {
      const delayMs = Math.max(0, Math.round(t.offset * 1000))
      graph.push(`[${i}:a]aformat=channel_layouts=stereo,adelay=delays=${delayMs}:all=1[m${i}]`)
      mixLabels.push(`[m${i}]`)
    })
  }

  const inputArgs =
    tracks.length > 0 ? tracks.flatMap((t) => ['-i', t.path]) : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']
  await finalizeWholeMix({ inputArgs, graph, mixLabels, idx, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format, reporter })
}

const FORMAT_CODECS = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-b:a', '192k']
}

// BUG FIX (reported directly, 2026-09-02): every export to Opus format
// failed outright ("Specified sample rate 44100 is not supported by the
// libopus encoder") - the final encode step hardcoded -ar 44100 for every
// format, but libopus only accepts 8000/12000/16000/24000/48000 Hz, never
// 44100. Every other format here is fine at 44100; only libopus needs a
// different output rate. ffmpeg resamples automatically to whatever -ar the
// output side asks for, regardless of the mix's own internal 44100 rate, so
// this is a safe, isolated fix - nothing upstream of the final encode needs
// to change.
const OUTPUT_SAMPLE_RATES = { opus: 48000 }
function outputSampleRate(format) {
  return OUTPUT_SAMPLE_RATES[format] ?? 44100
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

  await finalizeWholeMix({ inputArgs, graph, mixLabels, idx, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format, reporter })
}

// Optional companion output for the Export tab's video-mode choice
// ('video-only'/'both', see exportMix's own videoMode handling below) - the
// fallback shape when no loop video is chosen (see renderLoopedVideoFromFile
// below for that path). Ambient mixes get uploaded to YouTube, which needs a
// video track - a flat black frame is all that's wanted by default. Encoding a
// full-length black video would be per-frame work over hours; instead encode
// a 4-frame black clip once (instant) and -stream_loop it under the just-
// exported audio with -c copy - the mux is near-instant and the audio stays
// bit-identical. Container is .mkv: YouTube accepts it and, unlike .mp4, it
// carries any audio codec, so a copied Opus/Vorbis/FLAC/AAC stream just
// works. Video is 1 fps (fine for a static image, keeps the file near the
// size of the audio alone). `-t durationSeconds` caps the mux exactly:
// without it, `-stream_loop -1` + `-c copy` overshoots by whole loop
// iterations of the video read-ahead (measured ~10 s on a 20-min export);
// `-shortest` stays as a backstop. Returns the .mkv path.
async function renderBlackScreenVideo(audioPath, durationSeconds, reporter) {
  reporter?.step('Creating black-screen video for YouTube…')
  const clipPath = tempPath('mp4')
  const videoPath = audioPath.replace(/\.[^./\\]+$/, '') + '.mkv'
  try {
    await runFfmpegToFile([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=1',
      '-t', '4',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-g', '1', '-keyint_min', '1', '-sc_threshold', '0',
      clipPath
    ])
    await runFfmpegToFile([
      '-y',
      '-stream_loop', '-1', '-i', clipPath,
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c', 'copy', '-shortest',
      '-t', durationSeconds.toFixed(3),
      videoPath
    ])
    return videoPath
  } finally {
    await cleanupFiles([clipPath])
  }
}

// Reads a video's own container duration straight out of ffmpeg's stderr
// (`ffmpeg -i <file>` prints "Duration: HH:MM:SS.xx" before erroring for
// lack of an output, which is fine - the error itself is never inspected,
// only the stream-info line printed on the way there) - same technique
// bandEnergy.js's probeSourceSampleRate already uses for its own "Stream
// #0:0: Audio: N Hz" line, just a different regex. Cheap: exits almost
// immediately, no decoding.
function probeVideoDurationSeconds(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(), ['-i', inputPath], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      resolve(match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null)
    })
    child.on('error', () => resolve(null))
  })
}

// The Board's "associate a chosen video file to loop under the audio,
// instead of/alongside the black-screen option" (v0.1.141). Same overall
// shape as renderBlackScreenVideo above (mux the just-finished audio under a
// looped video track into one .mkv, `-c:a copy` so the audio stays
// bit-identical, `-t durationSeconds` pins the exact length rather than
// trusting `-shortest` alone) - the one real difference is the video itself
// has to be *re-encoded* (`-c:v libx264`), since an arbitrary user-supplied
// file could be any codec/container ffmpeg's `-c copy` mux might reject,
// unlike the black clip which was generated by this same function moments
// earlier and is known-good.
//
// Accepted limitation, not fixed here: if the chosen video is shorter than
// the export, `-stream_loop -1` repeats it with a hard cut at the seam - no
// crossfade/smoothing, unlike this app's audio loop clips. Real video
// crossfading (frame-accurate overlap via `xfade`) is meaningfully more
// ffmpeg-graph complexity than this feature's literal ask ("loop a video");
// shipping the plain loop first and picking up seam-smoothing later if it
// turns out to bother the owner in practice matches how this app has
// consistently shipped other tunables (ship simple, flag the tradeoff,
// iterate on real feedback rather than guessed-at polish). A video that
// already loops cleanly on its own (the common case for a "looping
// background" clip) won't show a seam at all regardless.
async function renderLoopedVideoFromFile(audioPath, durationSeconds, videoSourcePath, reporter) {
  reporter?.step(`Looping ${path.basename(videoSourcePath)} under the audio…`)
  const videoPath = audioPath.replace(/\.[^./\\]+$/, '') + '.mkv'
  const videoDuration = await probeVideoDurationSeconds(videoSourcePath)
  if (!videoDuration || videoDuration <= 0) {
    throw new Error(`Could not read the chosen video file (${path.basename(videoSourcePath)}).`)
  }
  const needsLoop = videoDuration < durationSeconds
  await runFfmpegToFile(
    [
      '-y',
      ...(needsLoop ? ['-stream_loop', '-1'] : []),
      '-i', videoSourcePath,
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-shortest',
      '-t', durationSeconds.toFixed(3),
      videoPath
    ],
    // BUG FIX (reported directly: "Percentage is stuck on 100%... if it's
    // 100% it means it's done"): this is a real -c:v libx264 re-encode
    // (unlike the near-instant -c copy black-screen mux), genuinely slow for
    // a long export duration - but totalWorkSeconds (below, in exportMix's
    // own reporter setup) never budgeted this phase at all, so the reporter
    // was already at fraction 1.0 by the time this ever started, and this
    // call reported zero progress during it (a plain fire-and-forget spawn).
    // Wired the same real-time ffmpeg-stderr-parsed progress the main
    // mixdown already gets.
    { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
  )
  reporter?.completePhase(durationSeconds)
  return videoPath
}

// Dispatches between the four companion-video shapes exportMix's own
// videoMode handling can produce: a real-time audio-reactive visualization
// (renderVisualizationVideo, see that module's own doc comment for the
// speed research behind it), a user-supplied video to loop
// (renderLoopedVideoFromFile), a looping still image with an optional
// spin/bounce animation (renderImageLoopVideo), or the original flat black
// screen (renderBlackScreenVideo) - the fallback whenever videoBackground is
// 'black', or 'file'/'image' was chosen but nothing has actually been picked
// yet. Kept as a separate dispatcher rather than folding the branch into any
// one of the four so every caller (video-only/both, see exportMix below)
// stays a single call site regardless of which shape actually runs.
function renderVideoOutput(audioPath, durationSeconds, videoBackground, loopVideoPath, visualization, imagePath, imageOptions, reporter) {
  if (videoBackground === 'visualization') {
    return renderVisualizationVideo(audioPath, durationSeconds, visualization, reporter)
  }
  if (videoBackground === 'file' && loopVideoPath) {
    return renderLoopedVideoFromFile(audioPath, durationSeconds, loopVideoPath, reporter)
  }
  if (videoBackground === 'image' && imagePath) {
    return renderImageLoopVideo(audioPath, durationSeconds, imagePath, imageOptions, reporter)
  }
  return renderBlackScreenVideo(audioPath, durationSeconds, reporter)
}

// sounds: [{ soundId, inputPath, cachedClipPath, name, playMode, loopStart,
//   loopEnd, filters, speedPitch, crossfadeSeconds, volume, groupId,
//   events }] - already fully resolved by the renderer + IPC handler
//   (library lookup, path resolution, event simulation). events is
//   null/empty for 'loop' mode, an array of { offsetSeconds, pitchSemitones,
//   volumeScale, speedFactor, fadeInMs, fadeOutMs, shotDurationSeconds } for
//   'scatter'/'scheduled' (shotDurationSeconds already reflects speedFactor).
//   groupId is the Sound Group (if any) this sound belongs to on this
//   preset - null/undefined plays exactly as before. groups: [{id, filters}]
//   - the preset's own Sound Groups, filters in the same shape as
//   wholeMixFilters minus fadeInSeconds (see presets.js's normalizeGroups).
export async function exportMix({ sounds, durationSeconds, format, wholeMixFilters, groups = [], fadeInSeconds, fadeOutSeconds, outputPath, onProgress, fasterExport = false, parallelMixdown = false, videoMode = 'audio-only', videoBackground = 'black', loopVideoPath = null, visualization = null, imagePath = null, imageMotion = 'none' }) {
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
      const batchSize = eventsNeedRubberband(events) ? EVENT_BATCH_SIZE : EVENT_BATCH_SIZE_LIGHT
      eventSounds.push({ sound, batches: planBatches(events, shotDur, batchSize) })
    }
  }

  // Under parallelMixdown, every loop sound gets its own full-duration
  // tiling pass (see tileLoopShotFull) instead of sharing one - so the work
  // estimate is N x duration for that phase plus another duration for the
  // (now cheap) final combine, rather than just the one duration the
  // default single-pass mixdown costs.
  const mixdownWorkSeconds = parallelMixdown ? loopSounds.length * durationSeconds + durationSeconds : durationSeconds
  // BUG FIX (reported directly: "Percentage is stuck on 100%... this is
  // taking SUUUUUUUPER LONG"): a 'file' (loop your own video) or
  // 'visualization' background is a real -c:v libx264 re-encode across the
  // whole export duration - genuinely slow, but never budgeted into the
  // progress total, so the bar hit 100% the instant the *audio* finished
  // and then sat there with zero visible movement for the entire video
  // encode. 'black' stays unbudgeted - its own mux is a near-instant -c
  // copy, not a real encode (see renderBlackScreenVideo's own comment).
  const needsVideo = videoMode === 'video-only' || videoMode === 'both'
  // Mirrors renderVideoOutput's own dispatch condition exactly (self-review
  // finding: this used to check only videoBackground's *type*, not whether a
  // path was actually chosen) - 'file'/'image' with nothing picked yet falls
  // through to the near-instant black-screen mux there, which never calls
  // reporter.completePhase(), so budgeting a real encode's worth of work for
  // it left the reporter's fraction permanently capped below 1.0 for the
  // rest of the export (invisible in the Export tab only because it hides
  // the bar the instant the promise resolves, not because it actually
  // reached 100%).
  const videoNeedsRealEncode =
    needsVideo &&
    (videoBackground === 'visualization' ||
      (videoBackground === 'file' && Boolean(loopVideoPath)) ||
      (videoBackground === 'image' && Boolean(imagePath)))
  const videoWorkSeconds = videoNeedsRealEncode ? durationSeconds : 0
  // Sound Group processing (renderGroupBuses) adds real, full-duration
  // ffmpeg work that wasn't budgeted before groups were export-aware: one
  // tileLoopShotFull pass per grouped loop-mode sound, plus roughly one more
  // duration's worth per used group for the combine+filter passes (two more
  // if that group's own reverb is active - applyGroupFilters then runs a
  // pre-reverb pass and the real reverb pass instead of one plain -af pass).
  // A rough estimate (not exact, unlike the audio-seconds-of-work budgeting
  // above) - good enough to keep the bar visibly moving instead of
  // stalling, which is the actual bug this class of fix (v0.1.150) cares
  // about.
  const groupedLoopSoundCount = loopSounds.filter((s) => s.groupId).length
  const usedGroupIds = new Set(sounds.map((s) => s.groupId).filter(Boolean))
  const groupsWithReverbCount = [...usedGroupIds].filter((id) => {
    const g = groups.find((group) => group.id === id)
    // Occlusion (v0.1.182) can imply a reverb pass even when the group's own
    // reverbSizeMs/reverbMix are 0 - budget against the effective values.
    const f = applyOcclusionToFilters(g?.filters)
    return (f.reverbSizeMs ?? 0) > 0 && (f.reverbMix ?? 0) > 0
  }).length
  const groupWorkSeconds =
    (groupedLoopSoundCount + usedGroupIds.size * 2 + groupsWithReverbCount) * durationSeconds
  // Fluctuation baking (v0.1.171 volume, v0.1.179 pitch) adds full-duration
  // ffmpeg work not budgeted before: an ungrouped fluctuating loop sound
  // needs its own tile pass (2x duration) plus one pass per active axis
  // (volume multiply and/or pitch rubberband); a grouped one skips the tile
  // (already counted in groupedLoopSoundCount) but still needs its axis
  // pass(es); a group or the whole mix drifting needs one volume-multiply
  // pass each. Same rough-estimate spirit as groupWorkSeconds above.
  const loopAxisPasses = (s) =>
    (hasVolumeFluctuation(s.fluctuation) ? 1 : 0) + (hasPitchFluctuation(s.fluctuation) ? 1 : 0)
  const fluctLoopUngrouped = loopSounds
    .filter((s) => !s.groupId)
    .reduce((sum, s) => sum + (loopAxisPasses(s) > 0 ? loopAxisPasses(s) + 1 : 0), 0)
  const fluctLoopGrouped = loopSounds.filter((s) => s.groupId).reduce((sum, s) => sum + loopAxisPasses(s), 0)
  const fluctGroupCount = [...usedGroupIds].filter((id) =>
    hasVolumeFluctuation(groups.find((group) => group.id === id)?.filters?.fluctuation)
  ).length
  const wholeMixFluctSeconds = hasVolumeFluctuation(wholeMixFilters?.fluctuation) ? durationSeconds : 0
  const fluctuationWorkSeconds =
    (fluctLoopUngrouped + fluctLoopGrouped + fluctGroupCount) * durationSeconds + wholeMixFluctSeconds
  const totalWorkSeconds =
    mixdownWorkSeconds +
    eventSounds.reduce((sum, es) => sum + es.batches.reduce((s, b) => s + b.span, 0), 0) +
    videoWorkSeconds +
    groupWorkSeconds +
    fluctuationWorkSeconds
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
  // parallelMixdown's own concurrency, independent of fasterExport (see
  // exportMix.js's doc comment - "a second, separate opt-in toggle" per the
  // owner's own framing) - the whole point is parallelizing the final
  // mixdown's loop-tiling regardless of whether the earlier phases are sped
  // up too. Same core-count/cap logic as fasterExport's.
  const mixdownConcurrency = parallelMixdown
    ? Math.max(1, Math.min((os.cpus()?.length ?? 2) - 1, FASTER_EXPORT_CONCURRENCY_CAP))
    : 1
  // The pre-combine ("Merging N track groups") rounds parallelize if *either*
  // opt-in toggle is on - each combine pass is a cheap adelay+amix, and this
  // phase was the biggest single time sink on the export that prompted
  // v0.1.136. Neither toggle => 1 => the old sequential walk, unchanged.
  const mergeConcurrency = Math.max(concurrency, mixdownConcurrency)

  const ownedShotPaths = [] // every owned shot clip - kept alive through the batch phase, cleaned at the very end
  const batchTrackPaths = []
  const tiledLoopTrackPaths = [] // parallelMixdown's per-sound full-duration tiles
  const groupBusPaths = [] // renderGroupBuses' own intermediates (tiles/combines/filtered buses)
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
      loopShots.push({
        path: shot.path,
        volume: sound.volume ?? 0.7,
        groupId: sound.groupId ?? null,
        fluctuation: sound.fluctuation ?? null
      })
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
      batchTracks.push({ ...track, groupId: job.sound.groupId ?? null })
    })

    // Sound Groups: pull out every sound that belongs to one, render each
    // group's own fully-mixed-and-filtered submix, and treat the result as
    // one more pre-rendered track (offset 0) alongside the genuinely
    // ungrouped ones - a no-op (same arrays back, untouched) when nothing in
    // this export actually uses a group. See renderGroupBuses's own doc
    // comment for why a grouped loop sound has to be tiled to full duration
    // here regardless of parallelMixdown.
    const { ungroupedLoopShots, tracksForFinalMix } = await renderGroupBuses({
      loopShots,
      batchTracks,
      groups,
      durationSeconds,
      reporter,
      concurrency: mergeConcurrency,
      ownPaths: groupBusPaths
    })

    // Per-sound Fluctuation (v0.1.171 volume, v0.1.179 pitch): an ungrouped
    // loop sound with its own volume and/or pitch drift can't ride
    // renderFinalMixdown's cheap -stream_loop path - it needs a materialized
    // full-duration track to multiply the drift envelope against / step
    // rubberband over (same as a grouped one already gets inside
    // renderGroupBuses). Tile + apply the drift here, then it joins the final
    // mix as a plain offset-0 track. Loop sounds with no drift stay on the
    // fast path untouched.
    const plainLoopShots = []
    const fluctuatingLoopTracks = []
    for (const shot of ungroupedLoopShots) {
      if (!hasLoopFluctuation(shot.fluctuation)) {
        plainLoopShots.push(shot)
        continue
      }
      reporter.step('Baking drift into a loop sound…')
      const tile = await tileLoopShotFull({ shot, durationSeconds, reporter })
      tiledLoopTrackPaths.push(tile.path)
      const { track: drifted, newPaths } = await applyLoopFluctuation(
        tile, shot.fluctuation, durationSeconds, reporter
      )
      tiledLoopTrackPaths.push(...newPaths)
      fluctuatingLoopTracks.push(drifted)
    }
    const finalMixTracks = [...tracksForFinalMix, ...fluctuatingLoopTracks]

    // Keep the final mixdown's input count under the OS command-line limit
    // (see MAX_INPUTS_PER_PASS). Loop shots each take one input too and can't
    // be pre-combined (they're -stream_loop tiled), so the batch tracks get
    // whatever's left of the budget. Cheap no-op when the export is small
    // enough that everything already fits.
    const batchTrackBudget = Math.max(4, MAX_INPUTS_PER_PASS - plainLoopShots.length)
    const finalBatchTracks =
      finalMixTracks.length > batchTrackBudget
        ? await reduceTrackCount(finalMixTracks, batchTrackBudget, groupBusPaths, reporter, mergeConcurrency, durationSeconds)
        : finalMixTracks

    if (parallelMixdown && plainLoopShots.length > 0) {
      // Tile every loop sound to its own full-duration track, several at
      // once - the actual Part B win, see tileLoopShotFull's doc comment.
      reporter.step(
        `Parallel mixdown on — tiling ${plainLoopShots.length} loop sound${plainLoopShots.length === 1 ? '' : 's'} at once…`
      )
      const tiledLoopTracks = []
      await mapPool(plainLoopShots, mixdownConcurrency, async (shot) => {
        const track = await tileLoopShotFull({ shot, durationSeconds, reporter })
        tiledLoopTrackPaths.push(track.path)
        tiledLoopTracks.push(track)
      })

      const combinedTracks = [...tiledLoopTracks, ...finalBatchTracks]
      const mergedTracks =
        combinedTracks.length > MAX_INPUTS_PER_PASS
          ? await reduceTrackCount(combinedTracks, MAX_INPUTS_PER_PASS, groupBusPaths, reporter, mergeConcurrency, durationSeconds)
          : combinedTracks

      reporter.step('Final mixdown + whole-mix processing…')
      await renderFinalMixFromTracks({
        tracks: mergedTracks,
        durationSeconds,
        wholeMixFilters,
        fadeInSeconds,
        fadeOutSeconds,
        outputPath,
        format,
        reporter
      })
    } else {
      reporter.step('Final mixdown + whole-mix processing…')
      await renderFinalMixdown({
        loopShots: plainLoopShots,
        batchTracks: finalBatchTracks,
        durationSeconds,
        wholeMixFilters,
        fadeInSeconds,
        fadeOutSeconds,
        outputPath,
        format,
        reporter
      })
    }
    reporter.step(`Encoding to ${String(format || 'wav').toUpperCase()} — done.`)

    // The audio file is complete and safe at this point. Both 'video-only'
    // and 'both' need it muxed into the black-screen video (ffmpeg has to
    // read a real audio file, there's no in-memory shortcut) - the only
    // difference is 'video-only' then deletes the now-redundant standalone
    // audio file once the video safely exists. A video failure is never
    // fatal to an already-good audio export: 'both' just reports the error
    // alongside ok:true, and 'video-only' quietly falls back to keeping the
    // audio file rather than deleting the only output that succeeded.
    if (videoMode === 'video-only' || videoMode === 'both') {
      try {
        const videoPath = await renderVideoOutput(
          outputPath,
          durationSeconds,
          videoBackground,
          loopVideoPath,
          visualization,
          imagePath,
          { motion: imageMotion, fadeInSeconds, fadeOutSeconds },
          reporter
        )
        if (videoMode === 'video-only') {
          await cleanupFiles([outputPath])
          return { ok: true, videoPath, audioRemoved: true }
        }
        return { ok: true, videoPath }
      } catch (err) {
        console.error('export video render failed', err)
        return { ok: true, videoError: err.message }
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('exportMix failed', err)
    // Reported directly: a real multi-hour export died with ENOSPC partway
    // through the final mixdown's own ffmpeg encode - renderFinalMixdown/
    // renderFinalMixFromTracks write straight to outputPath (no tmp-then-
    // rename the way loopClip.js's own renders do), so a mid-write failure
    // left a large, corrupt, half-written file sitting right at the
    // destination the user picked - confusing on its own (looks like a real,
    // if oddly short, result) and actively working against recovery from the
    // very failure that caused it (a disk that's already full stays full).
    // Best-effort: never let a cleanup problem mask the real error above.
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    } catch (cleanupErr) {
      console.error('exportMix: failed to remove partial output after failure', cleanupErr)
    }
    return { ok: false, error: err.message }
  } finally {
    await cleanupFiles([...ownedShotPaths, ...batchTrackPaths, ...tiledLoopTrackPaths, ...groupBusPaths])
  }
}
