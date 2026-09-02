// Synthetic (procedurally generated) impulse response for real convolution
// reverb, replacing "Reverb"'s old identity as just a preset combination of
// the Echo delay/decay knobs (a short delay + high decay + a touch of
// lowpass, approximating a room without ever actually being one) - direct
// owner request: "think of a way to better the echo/reverb experience...
// if you need to write a better way to work with echo and delay you should
// absolutely do it."
//
// Researched first (per this project's standing rule): a real recorded
// impulse response (from an actual room) is the usual professional choice,
// but exponentially-decaying noise is a well-documented, legitimate
// alternative with zero licensing/bundling cost - Moorer's 1979 "About This
// Reverberation Business" is the original source for "exponentially decaying
// white noise makes a surprisingly good sounding reverb response," and it's
// exactly what MDN's own ConvolverNode example and small libraries like
// reverbGen do instead of shipping recorded IR files. Chosen over bundling
// real IR audio assets - no licensing question, no extra install size, and
// this app already leans entirely on procedural/ffmpeg-generated audio
// wherever it can (waveform peaks, band-energy analysis, etc.) rather than
// shipping binary assets beyond ffmpeg itself.
//
// `src/main/ffmpeg/reverbIR.js` generates the equivalent IR for the ffmpeg
// bake (loopClip.js) via `anoisesrc`+`afade curve=exp` - matched in
// *character* (same decay shape) not bit-for-bit, which is all that matters
// perceptually for a reverb tail (unlike an EQ curve, exact noise phase
// isn't something a listener can compare against). Duplicated here rather
// than shared, per every other renderer/plugin split in this codebase - this
// file (core) and plugins/editor/audio/reverbIR.js (Remix preview) are
// separate copies of the same ~20 lines.
const REVERB_DECAY_EXPONENT = 3 // exp(-3) ≈ -26dB by the tail's own end

export function createReverbImpulse(audioContext, sizeSeconds) {
  const length = Math.max(1, Math.round(audioContext.sampleRate * sizeSeconds))
  const buffer = audioContext.createBuffer(2, length, audioContext.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const envelope = Math.exp(-REVERB_DECAY_EXPONENT * (i / length))
      data[i] = (Math.random() * 2 - 1) * envelope
    }
  }
  return buffer
}
