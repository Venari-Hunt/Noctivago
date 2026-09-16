// Tape-style ("varispeed") rendering of a looping sound's pitch drift for
// exports - the pure DSP half, deliberately free of any electron/ffmpeg
// import so test/varispeedCore.test.js can exercise it directly (same reason
// watchFolderTags.js / folderWalk.js are split out).
//
// Why varispeed: the live Mixer applies a buffer-mode loop sound's pitch
// Fluctuation through AudioBufferSourceNode.detune, which the Web Audio spec
// folds into the node's computed playback rate - raising the pitch also
// plays the audio slightly faster, like a tape machine. Exports used to bake
// the same drift with rubberband instead (pitch moves, tempo doesn't), which
// was both a mismatch with what the owner hears live and nearly all of the
// drift-baking phase's cost (~2.5 min per drifting sound on a 1-hour export).
// Reading the short loop clip at a time-varying rate is the export
// equivalent of what the live node does, and is cheap enough to do in JS.
//
// Interpolation is linear, matching Chromium's own AudioBufferSourceNode.

// Returns a stateful looper that produces interleaved Float32 output frames.
//   shot        - interleaved Float32Array of the loop clip
//   channels    - channel count of `shot` (and of the output)
//   ratios      - playback-rate multipliers sampled every `stepSeconds`
//                 (1 = no drift); linearly interpolated between samples
//   sampleRate  - sample rate of both `shot` and the output
//   gain        - scalar applied to every output sample
export function createVarispeedLooper({ shot, channels, ratios, stepSeconds, sampleRate, gain = 1 }) {
  const shotFrames = Math.floor(shot.length / channels)
  if (shotFrames < 1) throw new Error('varispeed: empty loop clip')
  if (!ratios || ratios.length < 1) throw new Error('varispeed: no rate samples')
  const framesPerStep = sampleRate * stepSeconds
  const lastIdx = ratios.length - 1
  let pos = 0
  let frame = 0

  return {
    // Fills and returns a Float32Array of `count` output frames.
    next(count) {
      const out = new Float32Array(count * channels)
      let o = 0
      for (let n = 0; n < count; n++) {
        const f = frame / framesPerStep
        const i = Math.floor(f)
        const rate = i >= lastIdx ? ratios[lastIdx] : ratios[i] + (ratios[i + 1] - ratios[i]) * (f - i)

        const p0 = Math.floor(pos)
        const frac = pos - p0
        const p1 = p0 + 1 >= shotFrames ? 0 : p0 + 1
        const a = p0 * channels
        const b = p1 * channels
        for (let c = 0; c < channels; c++) {
          const s0 = shot[a + c]
          out[o++] = (s0 + (shot[b + c] - s0) * frac) * gain
        }

        pos += rate
        while (pos >= shotFrames) pos -= shotFrames
        frame++
      }
      return out
    }
  }
}
