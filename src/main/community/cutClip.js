// "Cut to 15 s" for a community upload: a sound whose trimmed loop is long
// ships only CUT_SECONDS from the middle of that loop. Only the uploaded copy
// is cut; the user's own library sound is untouched. No Electron, no fs, so
// the tests can load it directly.
//
// Times that point into the file (loopStart/loopEnd, the noise-reduction
// sample window) are shifted to the new clip; the volume envelope (fractions
// of the loop) is remapped onto the shorter loop.

export const CUT_SECONDS = 15

// effective: the sound as the preset plays it ({ loopStart, loopEnd }, with
// the preset's own override already applied). loopEnd null = end of file.
// Returns the loop length in seconds, or null when unknown.
export function loopSeconds(effective, durationSeconds) {
  const start = effective?.loopStart ?? 0
  const end = effective?.loopEnd ?? durationSeconds
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, end - start)
}

export function canCut(effective, durationSeconds) {
  const len = loopSeconds(effective, durationSeconds)
  return len !== null && len > CUT_SECONDS + 0.5
}

// The [start, end) file seconds to keep, centered on the loop, or null.
export function cutWindow(effective, durationSeconds) {
  if (!canCut(effective, durationSeconds)) return null
  const start = effective.loopStart ?? 0
  const end = effective.loopEnd ?? durationSeconds
  const center = (start + end) / 2
  return { start: center - CUT_SECONDS / 2, end: center + CUT_SECONDS / 2 }
}

function envelopeGainAt(points, position) {
  if (position <= points[0].position) return points[0].gain
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (position <= b.position) {
      const t = b.position === a.position ? 0 : (position - a.position) / (b.position - a.position)
      return a.gain + (b.gain - a.gain) * t
    }
  }
  return points[points.length - 1].gain
}

// Keeps the part of the envelope inside the window, rescaled to 0..1, with
// the gain at each edge pinned so the shape reads the same.
function remapEnvelope(envelope, oldStart, oldLen, win) {
  const points = Array.isArray(envelope?.points) ? [...envelope.points].sort((a, b) => a.position - b.position) : []
  if (points.length === 0 || oldLen <= 0) return envelope
  const from = (win.start - oldStart) / oldLen
  const to = (win.end - oldStart) / oldLen
  const inside = points
    .filter((p) => p.position > from && p.position < to)
    .map((p) => ({ ...p, position: (p.position - from) / (to - from) }))
  return {
    ...envelope,
    points: [{ position: 0, gain: envelopeGainAt(points, from) }, ...inside, { position: 1, gain: envelopeGainAt(points, to) }]
  }
}

// Returns a copy of `bag` (a sound's portable settings, or a preset's
// override bag) with its times moved onto the cut clip. Keys the bag doesn't
// have stay absent, so an override keeps inheriting what it inherited.
// ownLoop: this bag's own { loopStart, loopEnd } before the cut (an override
// may trim differently from the baseline).
export function shiftForCut(bag, ownLoop, durationSeconds, win) {
  if (!bag) return bag
  const out = { ...bag }
  if ('loopStart' in out || 'loopEnd' in out) {
    out.loopStart = 0
    out.loopEnd = CUT_SECONDS
  }
  if (out.filters && typeof out.filters === 'object') {
    const filters = { ...out.filters }
    const oldStart = ownLoop?.loopStart ?? 0
    const oldLen = loopSeconds(ownLoop, durationSeconds) ?? 0
    if (filters.volumeEnvelope) filters.volumeEnvelope = remapEnvelope(filters.volumeEnvelope, oldStart, oldLen, win)
    if (Number.isFinite(filters.denoiseSampleStartSec) && Number.isFinite(filters.denoiseSampleEndSec)) {
      const s = Math.max(0, filters.denoiseSampleStartSec - win.start)
      const e = Math.min(CUT_SECONDS, filters.denoiseSampleEndSec - win.start)
      if (e - s >= 0.1) {
        filters.denoiseSampleStartSec = s
        filters.denoiseSampleEndSec = e
      } else {
        // The noise sample fell outside the kept 15 s; nothing left to profile.
        filters.denoiseEnabled = false
      }
    }
    out.filters = filters
  }
  return out
}
