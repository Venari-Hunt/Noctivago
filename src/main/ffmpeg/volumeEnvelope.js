import { GEN_RATE, writeWav } from './gainEnvelope.js'

// Bakes the Volume envelope feature (per-sound, Remix Sound mode, Loop mode
// only, v1) - user-drawn control points shaping volume over time, drawn
// directly on the waveform (Audacity's classic envelope tool) - into a
// control-signal WAV, reusing gainEnvelope.js's writeWav()/amultiply
// machinery verbatim. Deliberately NOT pitchEnvelope.js's asendcmd-driven
// approach: that has a real, hard-won ffmpeg 6.1.1 bug (v0.1.186) corrupting
// command files above ~3.2-3.5MB, which a WAV control signal has no
// equivalent ceiling for (no text command file at all). Unlike Fluctuation
// (a live-only random walk, re-generated fresh every playback/export so it
// can never be "baked" without freezing the randomness), this envelope is
// deterministic and user-authored, so it bakes straight into the loop clip's
// own short WAV at Save time (see loopClip.js's doRender) - a full export
// then rides the same cheap `-stream_loop` path any other loop-mode sound
// does, no per-export-duration tiling/amultiply cost the way continuous
// Fluctuation needs.
//
// `points` are the same {position, gain} shape the live Web Audio side uses
// (position 0..1 fraction of the loop region, gain 0..1 attenuation-only) -
// this only differs from src/renderer/audio's copy and
// plugins/editor/audio/PreviewSource.js's copy in that it samples onto a
// fixed-rate buffer for a WAV file instead of computing one value per rAF
// tick against live playback position. Three independent copies of the same
// linear-interpolation math for three separate JS realms (main process,
// core renderer, plugin) - this codebase's usual cross-directory/cross-
// process duplication reason.

function sampleEnvelopeGain(points, position) {
  if (points.length === 0) return 1
  if (position <= points[0].position) return points[0].gain
  const last = points[points.length - 1]
  if (position >= last.position) return last.gain
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (position >= a.position && position <= b.position) {
      const span = b.position - a.position
      const t = span > 0 ? (position - a.position) / span : 0
      return a.gain + (b.gain - a.gain) * t
    }
  }
  return 1
}

// Samples `points` onto a Float64Array of 0..1 gain values at GEN_RATE for
// `durationSeconds` - mirrors gainEnvelope.js's sampleVolumeWalk() in shape
// (same rate, same return type) so writeWav()/exportMix.js's amultiply
// fragment work on either's output identically, but this is a deterministic
// resample of user data instead of a random walk.
export function sampleVolumeEnvelope(points, durationSeconds) {
  const frames = Math.max(1, Math.ceil(durationSeconds * GEN_RATE))
  const out = new Float64Array(frames)
  const span = Math.max(durationSeconds, 0.0001)
  for (let i = 0; i < frames; i++) {
    const t = i / GEN_RATE
    const position = Math.min(Math.max(t / span, 0), 1)
    out[i] = sampleEnvelopeGain(points, position)
  }
  return out
}

// True when a volumeEnvelope config actually asks for shaping - enabled,
// at least 2 points, and not a plain flat neutral line (every point at gain
// 1) - the last check matters because "enabled" alone doesn't mean anything
// was actually drawn (a freshly-toggled-on envelope starts as the neutral
// 2-boundary-point default), and skipping a real ffmpeg pass for a no-op
// input keeps the loop-clip bake's fast path fast for the common case.
export function hasVolumeEnvelope(volumeEnvelope) {
  if (!volumeEnvelope?.enabled) return false
  const points = volumeEnvelope.points
  if (!Array.isArray(points) || points.length < 2) return false
  return points.some((p) => Math.abs(p.gain - 1) > 0.001)
}

// Renders the envelope for `durationSeconds` (the loop region's own short
// span, [0, loopEnd-loopStart) - never the full export/mix duration, since
// this bakes into the short loop clip that then gets looped) to a control-
// signal WAV. Returns the path (in export-tmp, covered by exportMix.js's own
// cleanup + the startup sweep) or null if the config isn't actually active.
export function renderVolumeEnvelopeWav(volumeEnvelope, durationSeconds) {
  if (!hasVolumeEnvelope(volumeEnvelope)) return null
  const values = sampleVolumeEnvelope(volumeEnvelope.points, durationSeconds)
  return writeWav(values)
}
