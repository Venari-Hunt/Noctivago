import { DEFAULT_SOUND_VOLUME } from '../../shared/constants.js'

// The volume sliders (the global one in the toolbar and every per-sound one
// in the Mixer) are bipolar: the center is unity gain - the sound playing at
// its own recorded level - and you drag left to attenuate down to silence or
// right to boost. Reported directly by the owner: "volume should start at the
// middle on a neutral state and you should be able to drag either left or
// right to make it louder or quieter."
//
// Slider position is 0..1 (the <input type="range"> carries 0..100). This
// maps it to a plain linear GainNode value, piecewise-linear in gain on each
// side of center so the feel stays easy to reason about ("halfway right of
// centre = 1.5x"). Full right is +6 dB (2x) - enough headroom to lift a
// quiet sound in the mix without inviting gross clipping.

export const VOLUME_MAX_GAIN = 2
export const DEFAULT_VOLUME = DEFAULT_SOUND_VOLUME

// pos (0..1) -> linear gain. 0 -> silence, 0.5 -> unity, 1 -> VOLUME_MAX_GAIN.
export function positionToGain(pos) {
  const p = Math.min(1, Math.max(0, Number(pos) || 0))
  if (p <= 0.5) return p / 0.5
  return 1 + ((p - 0.5) / 0.5) * (VOLUME_MAX_GAIN - 1)
}

// linear gain -> pos (0..1), the inverse of positionToGain. Clamped so a
// stored gain above VOLUME_MAX_GAIN still lands the thumb at the far right.
export function gainToPosition(gain) {
  const g = Math.max(0, Number(gain ?? 1))
  if (g <= 1) return (g / 1) * 0.5
  return Math.min(1, 0.5 + ((g - 1) / (VOLUME_MAX_GAIN - 1)) * 0.5)
}

// Convenience for the <input type="range" min="0" max="100"> elements.
export function gainToSlider(gain) {
  return Math.round(gainToPosition(gain) * 100)
}
export function sliderToGain(sliderValue) {
  return positionToGain(Number(sliderValue) / 100)
}
