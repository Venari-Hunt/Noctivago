import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { runFfmpegToFile } from './runFfmpeg.js'

// Synthetic (procedurally generated) impulse response for the ffmpeg-side
// half of real convolution reverb - see src/renderer/audio/reverbIR.js for
// the full rationale (exponentially-decaying noise instead of a bundled
// recorded IR - no licensing question, no extra install size). Generated
// with ffmpeg's own `anoisesrc` (noise generator) + `afade curve=exp`
// (exponential decay envelope) rather than hand-rolled sample math in JS,
// since this runs in the main process where ffmpeg is already the
// established way to synthesize audio (see waveformPeaks.js/bandEnergy.js
// for the same "let ffmpeg do it" preference over reimplementing DSP by
// hand). Matched in *character*, not bit-for-bit, with the live-preview
// version's own noise+decay shape - what matters for a reverb tail is the
// decay time/room-size feel agreeing between preview and bake, not sample-
// exact noise phase (unlike an EQ curve, which a listener actually can
// compare precisely).
//
// Cached under userData, one file per rounded size - the IR only depends on
// reverbSizeMs, never on the dry signal, so it's generated once per size
// ever actually used and reused after that (mirrors how loop clips
// themselves are a disposable derived cache, not regenerated needlessly).
const REVERB_IR_ROUNDING_MS = 100 // matches the Remix slider's own step
const REVERB_STEREO_CHANNELS = 2

function reverbIRDir() {
  return path.join(app.getPath('userData'), 'reverb-ir')
}

function reverbIRPath(sizeMs) {
  return path.join(reverbIRDir(), `${sizeMs}ms.wav`)
}

// Returns the on-disk path to a cached impulse response for this size,
// generating it first if it doesn't exist yet. sizeSeconds is rounded to the
// nearest REVERB_IR_ROUNDING_MS so a slider being dragged through many
// intermediate values doesn't spawn a cache file per pixel of drag.
export async function getOrCreateReverbIR(sizeSeconds) {
  const sizeMs = Math.max(REVERB_IR_ROUNDING_MS, Math.round((sizeSeconds * 1000) / REVERB_IR_ROUNDING_MS) * REVERB_IR_ROUNDING_MS)
  const irPath = reverbIRPath(sizeMs)
  if (fs.existsSync(irPath)) return irPath

  fs.mkdirSync(reverbIRDir(), { recursive: true })
  const tmpPath = `${irPath}.tmp`
  const durationSeconds = (sizeMs / 1000).toFixed(3)
  await runFfmpegToFile([
    '-y',
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:duration=${durationSeconds}:sample_rate=44100`,
    '-af', `afade=t=out:st=0:d=${durationSeconds}:curve=exp`,
    '-ac', String(REVERB_STEREO_CHANNELS),
    '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', tmpPath
  ])
  fs.renameSync(tmpPath, irPath)
  return irPath
}
