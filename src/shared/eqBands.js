// EQ band rules shared by live playback (src/renderer/audio/), the ffmpeg
// bake (src/main/ffmpeg/loopClip.js) and the phone player (noctivago-mobile),
// so a band is built the same way everywhere.

// 'off' is a pseudo-type (not a real BiquadFilterNode type), so it and a
// muted band (the Remix EQ's per-band Mute/Solo) become an 'allpass'
// stand-in. Muting never touches band.type itself, only whether the node
// applies it.
export function eqNodeType(band) {
  return band.muted || band.type === 'off' ? 'allpass' : (band.type ?? 'peaking')
}

// Only the four filter-*shaped* types have a real "slope" (rolloff
// steepness) concept - peaking/shelf types are gain-shaped, 'off' does
// nothing. A biquad is one fixed 12dB/octave stage, and ffmpeg's
// bandpass/bandreject have no `poles` parameter, so "Steep" is real
// cascading everywhere: STEEP_STAGE_COUNT identical stages in series, each
// multiplying the rolloff by another ~12dB/octave (verified against Web
// Audio and the bundled ffmpeg binary: four cascaded highpass=f=1000:poles=2
// measured ~34dB more attenuation than one, on a test tone).
export const SLOPE_CAPABLE_EQ_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
export const STEEP_STAGE_COUNT = 4

export function eqBandStageCount(band) {
  return band.slope === 'steep' && SLOPE_CAPABLE_EQ_TYPES.includes(band.type) ? STEEP_STAGE_COUNT : 1
}
