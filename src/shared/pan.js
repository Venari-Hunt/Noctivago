// Stereo pan (v0.1.216) - one pan law shared by live playback
// (src/renderer/audio/PanStage.js) and the ffmpeg bake
// (src/main/ffmpeg/panFilter.js), so the Mixer and an export can't drift
// apart. plugins/editor/audio/PanStage.js carries its own copy of this math
// (the plugin sandbox can't import this file) - keep them in sync.
//
// Works on a stereo pair; a mono source is treated as L = R = M first.
// Moving toward one side folds the far channel into the near one (so a sound
// panned hard left really is all in the left speaker, nothing lost) and
// fades the far side out on a mixer balance curve. The folded side is
// power-normalized, so loudness stays steady for wide stereo and a mono
// sound tops out at +3 dB in one speaker at a hard pan (a constant-power pan
// law) - unlike Web Audio's StereoPannerNode, whose fold reaches +6 dB.
// Center is exactly the identity, so an unpanned sound is untouched.

export function normalizePan(pan) {
  const p = Number(pan)
  if (!Number.isFinite(p)) return 0
  return Math.min(1, Math.max(-1, p))
}

// Returns [[LfromL, LfromR], [RfromL, RfromR]].
export function stereoPanMatrix(pan) {
  const p = normalizePan(pan)
  const a = Math.abs(p)
  // Far side: a mixer balance curve (-3 dB center law, normalized to 1 at
  // center), so a wide stereo recording audibly moves at moderate pans
  // (v0.1.227; the earlier cos curve gave wide stereo only 0.7 dB at 25%).
  const far = Math.SQRT2 * Math.cos(((1 + a) * Math.PI) / 4)
  // How much of the far channel the near side takes in (0 at center, all of
  // it at a hard pan).
  const fold = Math.sin((a * Math.PI) / 2)
  const norm = 1 / Math.sqrt(1 + fold * fold)
  if (p <= 0) {
    return [
      [norm, fold * norm],
      [0, far]
    ]
  }
  return [
    [far, 0],
    [fold * norm, norm]
  ]
}
