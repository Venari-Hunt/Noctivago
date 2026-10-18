import { applyOcclusionToFilters, MAX_BUFFER_CLIP_SECONDS } from '../../shared/constants.js'
import { loopSeconds } from '../community/cutClip.js'

// Rules for "Export for phone" (docs/mobile.md, phase 1). No Electron, no fs,
// so the tests can load it directly; phoneBundle.js runs the ffmpeg side.
//
// The phone only mixes: every sound ships as its baked clip (filters, EQ,
// echo, noise reduction, speed/pitch/reverse, Doppler, pan, crossfade), and
// Sound Group and whole-mix reverb are applied to each member's clip too, so
// the phone runs no convolver.

export const PHONE_BUNDLE_VERSION = 1

// react-native-audio-api decodes every clip to 32-bit float, stereo, 48 kHz.
export const DECODED_BYTES_PER_SECOND = 48000 * 2 * 4
export const PHONE_DECODED_BUDGET_BYTES = 300 * 1024 * 1024

export function isActiveReverb(filters) {
  return (filters?.reverbSizeMs ?? 0) > 0 && (filters?.reverbMix ?? 0) > 0
}

// The bus reverbs a sound passes through, in signal order: its Sound Group's,
// then the whole mix's. Occlusion folds into the reverb amount first, like the
// live chains (SoundGroupChain.js) and the export (exportMix.js) do.
export function busReverbs(groupFilters, wholeMix) {
  const out = []
  for (const filters of [groupFilters, wholeMix]) {
    if (!filters) continue
    const f = applyOcclusionToFilters(filters)
    if (isActiveReverb(f)) out.push({ sizeMs: f.reverbSizeMs, mix: f.reverbMix })
  }
  return out
}

// A bus's filters for the phone: occlusion folded in (its lowpass part stays
// live), reverb and occlusion cleared since the clips already carry them.
export function withoutReverb(filters) {
  if (!filters) return filters ?? null
  return { ...applyOcclusionToFilters(filters), occlusion: 0, reverbSizeMs: 0, reverbMix: 0 }
}

// A loop longer than the Mixer can hold in memory ships cut to 15 s.
export function needsCut(effective, durationSeconds) {
  const len = loopSeconds(effective, durationSeconds)
  return len !== null && len > MAX_BUFFER_CLIP_SECONDS
}

// How to wrap a reverb around a seamless loop of `clipSeconds`: play the loop
// `copies` times through the reverb and keep the last copy. Every copy before
// it covers the impulse's length, so the kept one hears the tail of the loop
// before it, exactly as it will when the phone loops it.
export function loopWrapPlan(clipSeconds, irSeconds) {
  const copies = Math.ceil(irSeconds / clipSeconds) + 1
  return { copies, keepFromSeconds: (copies - 1) * clipSeconds }
}

// The sound's settings once its clip is baked: the clip loops whole, and
// nothing the clip carries is applied again. Scatter, schedule, Fluctuation
// and play mode stay, since the phone runs them live.
export function phoneSettings(effective, clipSeconds) {
  const out = { ...effective }
  out.loopStart = 0
  out.loopEnd = clipSeconds
  out.crossfadeSeconds = 0
  out.speedPitch = null
  out.filters = {}
  return out
}

export function decodedBytes(seconds) {
  return Math.round(seconds * DECODED_BYTES_PER_SECOND)
}

// One line for the result, or null when the preset fits.
export function memoryWarning(totalSeconds) {
  const bytes = decodedBytes(totalSeconds)
  if (bytes <= PHONE_DECODED_BUDGET_BYTES) return null
  const mb = Math.round(bytes / (1024 * 1024))
  return `This preset needs about ${mb} MB of memory on the phone (target: under ${Math.round(PHONE_DECODED_BUDGET_BYTES / (1024 * 1024))} MB). Older phones may fail to play it; shorten the longest loops in Remix.`
}
