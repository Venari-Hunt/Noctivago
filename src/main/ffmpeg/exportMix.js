import { app } from 'electron'
import fs from 'node:fs'
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
// to actually render that into audio:
//
// - A 'loop' sound has no discrete events at all - one crossfaded loop
//   iteration (reusing loopClip.js's existing bake, unchanged) tiled via
//   ffmpeg's own -stream_loop for the full export duration.
// - A 'scatter'/'scheduled' sound bakes a single one-shot "shot" clip
//   (crossfade forced to 0, matching effectiveCrossfadeSeconds' existing
//   reasoning - a one-shot is never rotated against itself), then places a
//   copy of it at each simulated event's own offset via ffmpeg's
//   asplit+adelay+amix - verified directly against the real bundled binary
//   (150 shots across a 5-minute track rendered in ~4s, correct output
//   duration) before any of this was wired into the app. Written to a
//   *script file* and referenced via -filter_complex_script rather than
//   inlined on the command line, specifically so a dense export (many
//   shots) can't run into a Windows command-line length limit.
//
// Every per-sound track renders to its own temp file at the *exact* export
// duration; the final step just amixes those together, applies the
// whole-mix EQ/gain and fade in/out *last* (per the owner's own explicit
// ordering - "should be applied on the whole mix after everything"), and
// encodes to the chosen output format.

function exportTempDir() {
  return path.join(app.getPath('userData'), 'export-tmp')
}

function tempPath(ext) {
  return path.join(exportTempDir(), `${crypto.randomUUID()}.${ext}`)
}

async function cleanupFiles(paths) {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      // best-effort cleanup - a leftover temp file isn't worth failing the export over
    }
  }
}

// One crossfaded loop iteration, tiled to fill durationSeconds. Volume is
// applied here (not in the final mixdown) since -stream_loop just repeats
// raw samples with no room to inject a per-sound gain stage mid-tile.
async function renderLoopModeTrack({ inputPath, loopStart, loopEnd, filters, speedPitch, crossfadeSeconds, volume, durationSeconds }) {
  const shotPath = tempPath('wav')
  const trackPath = tempPath('wav')
  const result = await renderClipToPath({ inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch, outputPath: shotPath })
  if (!result.ok) {
    await cleanupFiles([shotPath])
    throw new Error(result.error ?? 'loop-mode shot render failed')
  }
  try {
    await runFfmpegToFile([
      '-y',
      '-stream_loop', '-1', '-i', shotPath,
      '-af', `volume=${volume}`,
      '-t', durationSeconds.toFixed(6),
      '-c:a', 'pcm_s16le', '-ar', '44100', '-vn', trackPath
    ])
    return trackPath
  } finally {
    await cleanupFiles([shotPath])
  }
}

// Instantiating rubberband once per event and letting a single ffmpeg
// process hold every branch alive at once was found to scale very badly -
// rubberband's own cost is proportional to the shot's duration, and ffmpeg
// runs a filter graph's branches on one thread, so N branches means N times
// the work serialized into one process. Verified directly against the real
// bundled binary before writing this: a 1-hour export with a single default-
// settings scatter sound (194 shots, matching the Export tab's own default
// length) and a realistic ~90s shot never finished in 90+ seconds and was
// still climbing past 1.3GB of RAM when killed - this is the exact "took
// whatever RAM it could get and still produced nothing" symptom reported.
// The same 194 shots at a short (3s) shot duration finished fine (56s,
// 330MB) - so the failure mode is specifically long-shot × many-event
// combinations (a scatter/scheduled sound whose trimmed clip was never
// shortened down to a brief "event" length), not scatter/export in general.
// Batching bounds this: rendering EVENT_BATCH_SIZE branches per ffmpeg
// process at a time (25 branches measured at ~40s/500MB) keeps peak memory
// bounded regardless of total event count, trading "one huge process that
// may never finish" for "several bounded processes that reliably do" - a
// smaller batch of 25 verified working directly, this keeps a safety margin
// below that.
const EVENT_BATCH_SIZE = 20
// Below this, a pitch shift is inaudible - skip the (expensive) rubberband
// node entirely and pass the shot straight to volume/fade/delay, matching
// how eqNodeType elsewhere in this codebase treats a true no-op as "skip the
// node," not "run it at neutral settings."
const IDENTITY_PITCH_EPSILON_SEMITONES = 0.02

function eventBranchChain(evt, volume) {
  const semitones = evt.pitchSemitones ?? 0
  const gain = (evt.volumeScale ?? 1) * volume
  const fadeParts = []
  if (evt.fadeInMs > 0) fadeParts.push(`afade=t=in:d=${(evt.fadeInMs / 1000).toFixed(3)}`)
  if (evt.fadeOutMs > 0 && Number.isFinite(evt.shotDurationSeconds)) {
    const start = Math.max(0, evt.shotDurationSeconds - evt.fadeOutMs / 1000)
    fadeParts.push(`afade=t=out:st=${start.toFixed(3)}:d=${(evt.fadeOutMs / 1000).toFixed(3)}`)
  }
  const chain = []
  if (Math.abs(semitones) >= IDENTITY_PITCH_EPSILON_SEMITONES) {
    chain.push(`rubberband=pitch=${Math.pow(2, semitones / 12).toFixed(6)}`)
  }
  chain.push(`volume=${gain.toFixed(6)}`, ...fadeParts)
  const delayMs = Math.max(0, Math.round(evt.offsetSeconds * 1000))
  chain.push(`adelay=${delayMs}|${delayMs}`)
  return chain.join(',')
}

// Renders one bounded batch of events (<= EVENT_BATCH_SIZE) against the shot
// clip into its own full-duration track.
async function renderEventBatchTrack({ shotPath, events, volume, durationSeconds }) {
  const trackPath = tempPath('wav')
  const scriptPath = tempPath('txt')
  try {
    const n = events.length
    const splitLabels = events.map((_, i) => `[s${i}]`).join('')
    const parts = [`[0:a]asplit=${n}${splitLabels};`]
    const mixLabels = []
    events.forEach((evt, i) => {
      parts.push(`[s${i}]${eventBranchChain(evt, volume)}[d${i}];`)
      mixLabels.push(`[d${i}]`)
    })
    parts.push(`${mixLabels.join('')}amix=inputs=${n}:duration=longest:dropout_transition=0,apad=whole_dur=${durationSeconds.toFixed(6)}[out]`)
    fs.writeFileSync(scriptPath, parts.join(''))

    await runFfmpegToFile([
      '-y', '-i', shotPath,
      '-filter_complex_script', scriptPath,
      '-map', '[out]',
      '-t', durationSeconds.toFixed(6),
      '-c:a', 'pcm_s16le', '-ar', '44100', trackPath
    ])
    return trackPath
  } finally {
    await cleanupFiles([scriptPath])
  }
}

// Merges several already-rendered, already-full-duration batch tracks into
// one - a plain amix with no rubberband/fades involved, so unlike the batch
// renders above this is cheap regardless of how many batches there are.
async function combineBatchTracks({ trackPaths, durationSeconds }) {
  if (trackPaths.length === 1) return trackPaths[0]
  const mergedPath = tempPath('wav')
  const scriptPath = tempPath('txt')
  try {
    const n = trackPaths.length
    const mixLabels = trackPaths.map((_, i) => `[${i}:a]`).join('')
    fs.writeFileSync(scriptPath, `${mixLabels}amix=inputs=${n}:duration=longest:dropout_transition=0,apad=whole_dur=${durationSeconds.toFixed(6)}[out]`)
    const inputArgs = trackPaths.flatMap((p) => ['-i', p])
    await runFfmpegToFile([
      '-y', ...inputArgs,
      '-filter_complex_script', scriptPath,
      '-map', '[out]',
      '-t', durationSeconds.toFixed(6),
      '-c:a', 'pcm_s16le', '-ar', '44100', mergedPath
    ])
    return mergedPath
  } finally {
    await cleanupFiles([scriptPath])
  }
}

// Places a copy of the baked one-shot "shot" clip at each simulated event's
// own offset, with that event's own pitch/volume/fade - see the module
// comment above for why this is asplit+adelay+amix rather than one -i per
// shot (avoids opening the same short file hundreds of times), why the graph
// is written to a script file rather than inlined, and why it's batched
// (EVENT_BATCH_SIZE above) rather than one single graph for every event.
async function renderEventBasedTrack({ inputPath, loopStart, loopEnd, filters, volume, events, durationSeconds }) {
  const shotPath = tempPath('wav')
  // Scatter/scheduled sounds never crossfade against themselves (a one-shot
  // isn't looped back-to-back) - matches effectiveCrossfadeSeconds' existing
  // reasoning across the rest of the app.
  const result = await renderClipToPath({ inputPath, loopStart, loopEnd, filters, crossfadeSeconds: 0, speedPitch: null, outputPath: shotPath })
  if (!result.ok) {
    await cleanupFiles([shotPath])
    throw new Error(result.error ?? 'shot render failed')
  }
  try {
    if (events.length === 0) {
      // Nothing ever fires in this export window - a silent track of the
      // right length, so the final amix still has something to combine.
      const trackPath = tempPath('wav')
      await runFfmpegToFile([
        '-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
        '-t', durationSeconds.toFixed(6),
        '-c:a', 'pcm_s16le', trackPath
      ])
      return trackPath
    }

    const batchTracks = []
    try {
      for (let i = 0; i < events.length; i += EVENT_BATCH_SIZE) {
        const batch = events.slice(i, i + EVENT_BATCH_SIZE)
        batchTracks.push(await renderEventBatchTrack({ shotPath, events: batch, volume, durationSeconds }))
      }
    } catch (err) {
      await cleanupFiles(batchTracks)
      throw err
    }
    if (batchTracks.length === 1) return batchTracks[0]
    const merged = await combineBatchTracks({ trackPaths: batchTracks, durationSeconds })
    await cleanupFiles(batchTracks)
    return merged
  } finally {
    await cleanupFiles([shotPath])
  }
}

const FORMAT_CODECS = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
  opus: ['-c:a', 'libopus', '-b:a', '128k'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-b:a', '192k']
}

// Whole-mix EQ/gain and fade in/out apply *last*, after every per-sound
// track has already been combined - the owner's own explicit ordering
// ("should be applied on the whole mix after everything"). A simple three-
// control set (highpass/lowpass/gain) for v1, not the full 7-band
// parametric EQ the per-sound Remix editor has - deliberately scoped down,
// noted directly rather than silently expanded.
async function renderFinalMixdown({ trackPaths, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format }) {
  const mixParts = []
  const n = trackPaths.length
  const mixLabels = trackPaths.map((_, i) => `[${i}:a]`).join('')
  mixParts.push(`${mixLabels}amix=inputs=${n}:duration=longest:dropout_transition=0,apad=whole_dur=${durationSeconds.toFixed(6)}[mixed]`)

  const postParts = []
  if (wholeMixFilters?.highpassHz > 0) postParts.push(`highpass=f=${wholeMixFilters.highpassHz}`)
  if (wholeMixFilters?.lowpassHz > 0 && wholeMixFilters.lowpassHz < 20000) postParts.push(`lowpass=f=${wholeMixFilters.lowpassHz}`)
  if (wholeMixFilters?.gainDb) postParts.push(`volume=${wholeMixFilters.gainDb}dB`)
  if (fadeInSeconds > 0) postParts.push(`afade=t=in:d=${fadeInSeconds.toFixed(3)}`)
  if (fadeOutSeconds > 0) postParts.push(`afade=t=out:st=${Math.max(0, durationSeconds - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`)

  const lastLabel = postParts.length > 0 ? '[out]' : '[mixed]'
  if (postParts.length > 0) mixParts.push(`[mixed]${postParts.join(',')}[out]`)

  const scriptPath = tempPath('txt')
  fs.writeFileSync(scriptPath, mixParts.join(';'))

  const codecArgs = FORMAT_CODECS[format] ?? FORMAT_CODECS.wav
  try {
    const inputArgs = trackPaths.flatMap((p) => ['-i', p])
    await runFfmpegToFile([
      '-y', ...inputArgs,
      '-filter_complex_script', scriptPath,
      '-map', lastLabel,
      '-t', durationSeconds.toFixed(6),
      ...codecArgs,
      '-ar', '44100',
      outputPath
    ])
  } finally {
    await cleanupFiles([scriptPath])
  }
}

// sounds: [{ inputPath, playMode, loopStart, loopEnd, filters, speedPitch,
//   crossfadeSeconds, volume, events }] - already fully resolved by the
// renderer (library lookup + simulation both happen there; this module only
// renders). events is null/empty for 'loop' mode, an array of
// {offsetSeconds, pitchSemitones, volumeScale, fadeInMs, fadeOutMs,
// shotDurationSeconds} for 'scatter'/'scheduled'.
export async function exportMix({ sounds, durationSeconds, format, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath }) {
  fs.mkdirSync(exportTempDir(), { recursive: true })
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const trackPaths = []
  try {
    for (const sound of sounds) {
      const track =
        sound.playMode === 'loop'
          ? await renderLoopModeTrack({ ...sound, durationSeconds })
          : await renderEventBasedTrack({ ...sound, durationSeconds })
      trackPaths.push(track)
    }
    if (trackPaths.length === 0) {
      throw new Error('No sounds to export')
    }
    await renderFinalMixdown({ trackPaths, durationSeconds, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath, format })
    return { ok: true }
  } catch (err) {
    console.error('exportMix failed', err)
    return { ok: false, error: err.message }
  } finally {
    await cleanupFiles(trackPaths)
  }
}
