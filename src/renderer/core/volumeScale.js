import { DEFAULT_SOUND_VOLUME, VOLUME_MAX_GAIN, VOLUME_MIN_DB } from '../../shared/constants.js'

// The volume sliders (the global one in the toolbar and every per-sound one
// in the Mixer) are bipolar: the center is unity gain - the sound playing at
// its own recorded level - and you drag left to attenuate down to silence or
// right to boost. Reported directly by the owner: "volume should start at the
// middle on a neutral state and you should be able to drag either left or
// right to make it louder or quieter."
//
// Slider position is 0..1 (the <input type="range"> carries 0..SLIDER_STEPS).
// Left of centre is a decibel taper: 0 dB at the centre down to VOLUME_MIN_DB
// just before the far left, which is silence. Owner (2026-09-27): the quiet
// end felt coarse. It was linear in gain, which spends most of the travel on
// the first -6 dB and crams everything quieter into the last few steps; equal
// dB per step matches how loudness is heard. Right of centre stays linear in
// gain up to VOLUME_MAX_GAIN (+6 dB) - boosting has other tools.

export { VOLUME_MAX_GAIN }
export const DEFAULT_VOLUME = DEFAULT_SOUND_VOLUME

// 1000 steps instead of 100, so a drag or an arrow key moves ~0.1 dB on the
// quiet side.
export const SLIDER_STEPS = 1000

// pos (0..1) -> linear gain. 0 -> silence, 0.5 -> unity, 1 -> VOLUME_MAX_GAIN.
export function positionToGain(pos) {
  const p = Math.min(1, Math.max(0, Number(pos) || 0))
  if (p <= 0) return 0
  if (p <= 0.5) return 10 ** ((VOLUME_MIN_DB * (1 - p / 0.5)) / 20)
  return 1 + ((p - 0.5) / 0.5) * (VOLUME_MAX_GAIN - 1)
}

// linear gain -> pos (0..1), the inverse of positionToGain. Clamped so a
// stored gain above VOLUME_MAX_GAIN still lands the thumb at the far right,
// and one below VOLUME_MIN_DB at the far left.
export function gainToPosition(gain) {
  const g = Math.max(0, Number(gain ?? 1))
  if (g <= 0) return 0
  if (g <= 1) return Math.max(0, 0.5 * (1 - (20 * Math.log10(g)) / VOLUME_MIN_DB))
  return Math.min(1, 0.5 + ((g - 1) / (VOLUME_MAX_GAIN - 1)) * 0.5)
}

// Convenience for the <input type="range" min="0" max={SLIDER_STEPS}> elements.
export function gainToSlider(gain) {
  return Math.round(gainToPosition(gain) * SLIDER_STEPS)
}
export function sliderToGain(sliderValue) {
  return positionToGain(Number(sliderValue) / SLIDER_STEPS)
}
