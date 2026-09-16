// Stereo pan (v0.1.216) - one pan law shared by live playback
// (src/renderer/audio/PanStage.js) and the ffmpeg bake
// (src/main/ffmpeg/panFilter.js), so the Mixer and an export can't drift
// apart. plugins/editor/audio/PanStage.js carries its own copy of this math
// (the plugin sandbox can't import this file) - keep them in sync.
//
// Works on a stereo pair; a mono source is treated as L = R = M first.
// Moving toward one side folds the far channel into the near one (so a sound
// panned hard left really is all in the left speaker, nothing lost) and
// fades the far side out on an equal-power curve. The folded side is
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
  if (p <= 0) {
    const x = ((p + 1) * Math.PI) / 2
    const fold = Math.cos(x)
    const norm = 1 / Math.sqrt(1 + fold * fold)
    return [
      [norm, fold * norm],
      [0, Math.sin(x)]
    ]
  }
  const x = (p * Math.PI) / 2
  const fold = Math.sin(x)
  const norm = 1 / Math.sqrt(1 + fold * fold)
  return [
    [Math.cos(x), 0],
    [fold * norm, norm]
  ]
}
