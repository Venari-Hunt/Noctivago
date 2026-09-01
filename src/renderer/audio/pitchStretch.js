// Time-preserving pitch shift for short one-shot clips.
//
// Random Interval ("scatter") and Scheduled sounds roll a random pitch per
// shot. Before v0.1.111 that pitch was applied by resampling (an
// AudioBufferSourceNode's `detune`, which the Web Audio spec folds into the
// same computedPlaybackRate `playbackRate` would use) - so a pitched-up shot
// genuinely played *faster and shorter*, a pitched-down one slower and
// longer. The owner asked for a shot to keep the length it was trimmed to
// regardless of pitch ("i would prefer if the sounds kept the length i set
// it to"), on both the Mixer and in exports.
//
// The fix, for a sound playing from an already-decoded AudioBuffer (buffer
// mode - the common case, since scatter/scheduled shot clips are short and
// almost always baked): pre-stretch the buffer in time by the pitch ratio,
// then let the existing `detune` play it back at that ratio. Stretch by `r`
// (r ~ 1.06 per +1 semitone) makes the buffer r x longer at the same pitch;
// playing it at rate r shifts pitch up by r *and* pulls the length back to
// the original. Net: pitch moves, duration doesn't. Pitch down is the same
// with r < 1.
//
// The stretch is WSOLA (waveform-similarity overlap-add): overlapping input
// frames are placed at a scaled synthesis hop, and before each one is
// overlap-added its read position is nudged within a small window to the
// offset that best cross-correlates with the previous frame's natural
// continuation - which is what keeps periodic content (a bird call, a
// chime) from phasing at the frame joins. Chosen over a phase vocoder: no
// FFT, exact constant-overlap-add at 50% Hann overlap (so amplitude is
// preserved with zero normalization guesswork and no edge blow-up), and it
// holds up on the noisy/broadband textures this app mostly plays (rain,
// wind, crowd) about as well as a phase vocoder does. Its weak spot is a
// sharp isolated transient, which can get a faint doubling - flagged for a
// feel pass.
//
// No AudioWorklet: the work is a few milliseconds on a multi-second clip and
// runs off a setTimeout (shot scheduling), never the audio thread, so a
// plain synchronous function on the raw samples is simpler and testable in
// isolation (see the pitch-stretch test harness). Stream mode (a trim too
// long to bake) is left resampling - it has no in-memory samples to
// pre-stretch and is a rare fallback; that one spot still couples pitch to
// tempo.

const TWO_PI = Math.PI * 2

// Below this, a pitch shift is inaudible - skip the whole stretch, matching
// how the export pipeline (IDENTITY_PITCH_EPSILON_SEMITONES) and eqNodeType
// elsewhere treat a true no-op as "skip", not "run at neutral settings".
export const IDENTITY_PITCH_EPSILON_SEMITONES = 0.02

// A clip longer than this isn't worth stretching synchronously. `pitchShiftBuffer`
// returns null past it so the caller falls back to plain resampling for that
// shot - a scatter/scheduled "shot" clip this long is unusual anyway.
const MAX_STRETCH_SECONDS = 12

const FRAME_SIZE = 1024
// Synthesis hop = FRAME_SIZE / 2 => 50% overlap, where a Hann window has
// exact constant-overlap-add (consecutive windows sum to 1.0 everywhere).
const SYNTH_HOP = FRAME_SIZE / 2
// How far (samples) the read position may be nudged to find a better join.
// ~1 period of a 170 Hz tone at 44.1 kHz - covers the pitched range of most
// tonal one-shots without letting the search wander far enough to skip real
// content.
const SEARCH_RADIUS = 256
// How many samples of the overlap region the similarity search actually
// correlates. Aligning the leading part of the join is enough, and a shorter
// window keeps the (main-thread) search cheap.
const MATCH_LEN = 256

function hann(n) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / n)
  return w
}

// Normalized cross-correlation of two equal-length windows of `signal`
// starting at `aStart` and `bStart`. Range roughly [-1, 1]; higher = more
// similar. Guards against a zero-energy window (silence).
function ncc(signal, aStart, bStart, len) {
  let dot = 0
  let aEnergy = 0
  let bEnergy = 0
  for (let i = 0; i < len; i++) {
    const a = signal[aStart + i] || 0
    const b = signal[bStart + i] || 0
    dot += a * b
    aEnergy += a * a
    bEnergy += b * b
  }
  const denom = Math.sqrt(aEnergy * bEnergy)
  return denom > 1e-9 ? dot / denom : 0
}

// WSOLA time-stretch of a mono Float32Array by `stretch` (output length ~
// input length * stretch, same pitch).
export function timeStretch(input, stretch) {
  if (!(stretch > 0) || input.length < FRAME_SIZE * 2) return input.slice()

  const frame = FRAME_SIZE
  const half = SYNTH_HOP // overlap length between consecutive synthesis frames
  const anaHop = Math.max(1, Math.round(SYNTH_HOP / stretch))
  const win = hann(frame)

  const wantedLen = Math.round(input.length * stretch)
  const out = new Float32Array(wantedLen + frame)

  // Frame 0: copied straight in, but only its trailing half is Hann-tapered
  // (the leading half stays at full level) so a sharp attack at t=0 survives
  // instead of being faded in over ~12 ms.
  for (let i = 0; i < frame; i++) {
    const w = i < half ? 1 : win[i]
    out[i] += input[i] * w
  }

  let anaPos = 0 // start (in input) of the frame just placed
  let synPos = SYNTH_HOP // where the next frame goes in output

  while (true) {
    // The join sounds best if the next frame's leading `half` samples
    // continue smoothly from where the previous frame was heading in the
    // *input* - i.e. from input[anaPos + SYNTH_HOP ...]. Search around the
    // nominal analysis position for the read offset that matches that best.
    const target = anaPos + SYNTH_HOP
    const center = anaPos + anaHop
    // Bias toward the natural hop (delta 0): only stray from it for a
    // genuinely better join. Without this, periodic content (a pure tone is
    // the pathological case) has many equally-good matches a period apart
    // and the search drifts, which shows up as a pitch change.
    const scoreAt = (delta) => {
      const cand = center + delta
      if (cand < 0 || cand + MATCH_LEN >= input.length || target + MATCH_LEN >= input.length) return -Infinity
      return ncc(input, cand, target, MATCH_LEN) - 0.05 * Math.abs(delta) / SEARCH_RADIUS
    }
    // Coarse scan (step 4) then a fine refine around the winner - a scatter
    // shot fires off a setTimeout, so this runs on the main thread and an
    // exhaustive per-sample search over a multi-second clip was measurably
    // janky.
    let bestDelta = 0
    let bestScore = -Infinity
    for (let delta = -SEARCH_RADIUS; delta <= SEARCH_RADIUS; delta += 4) {
      const score = scoreAt(delta)
      if (score > bestScore) {
        bestScore = score
        bestDelta = delta
      }
    }
    for (let delta = bestDelta - 3; delta <= bestDelta + 3; delta++) {
      if (delta === bestDelta) continue
      const score = scoreAt(delta)
      if (score > bestScore) {
        bestScore = score
        bestDelta = delta
      }
    }

    const frameStart = center + bestDelta
    if (frameStart < 0 || frameStart + frame >= input.length) break
    if (synPos + frame >= out.length) break

    const lastFrame = frameStart + anaHop + SEARCH_RADIUS + frame >= input.length
    for (let i = 0; i < frame; i++) {
      // Trailing half of the very last frame stays full-level too, so a
      // decaying tail isn't chopped by an early fade.
      const w = lastFrame && i >= half ? 1 : win[i]
      out[synPos + i] += input[frameStart + i] * w
    }

    anaPos = frameStart
    synPos += SYNTH_HOP
  }

  return out.slice(0, wantedLen)
}

// Build a new AudioBuffer that, when played back at rate `2^(semitones/12)`
// (i.e. with `detune = semitones * 100` on the source node, which the caller
// still sets), sounds pitch-shifted by `semitones` while lasting the same
// wall-clock time as the original.
//
// Returns the original buffer unchanged for a sub-threshold shift, and null
// if the clip is too long to stretch synchronously (caller should fall back
// to plain resampling for that shot).
export function pitchShiftBuffer(context, audioBuffer, semitones) {
  if (Math.abs(semitones) < IDENTITY_PITCH_EPSILON_SEMITONES) return audioBuffer
  if (audioBuffer.duration > MAX_STRETCH_SECONDS) return null

  const ratio = Math.pow(2, semitones / 12)
  const channels = audioBuffer.numberOfChannels
  const stretched = []
  let outLen = 0
  for (let ch = 0; ch < channels; ch++) {
    const s = timeStretch(audioBuffer.getChannelData(ch), ratio)
    stretched.push(s)
    if (s.length > outLen) outLen = s.length
  }
  const outBuf = context.createBuffer(channels, outLen, audioBuffer.sampleRate)
  for (let ch = 0; ch < channels; ch++) {
    outBuf.getChannelData(ch).set(stretched[ch])
  }
  return outBuf
}
