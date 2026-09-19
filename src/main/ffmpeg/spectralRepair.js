// Spectral repair (per-sound, Remix Sound mode): the user draws boxes on a
// spectrogram - a time range crossed with a frequency range - and just that
// box gets turned down, so a cough, a bird chirp or a phone buzz can be
// removed without touching the rest of the sound at those same frequencies.
// Audacity's SpectralEditMulti.ny does it with a biquad filter crossfaded
// against the dry signal at the time edges. This does it in one ffmpeg stage
// instead: afftfilt scales the FFT bins inside each box, and its own
// overlap-add (Hann window, 75% overlap) spreads every on/off transition over
// about one window (~90 ms at 44.1kHz), so the box edges fade rather than
// click - no dry/wet split, no second input, and no latency to line up
// (verified against the bundled ffmpeg 6.1.1: a 3kHz tone inside the box
// drops ~40dB, a 500Hz tone outside it is unchanged to within 0.01dB).
//
// Two afftfilt facts found by testing, not in its docs: `pts` is in samples
// (the input time base is 1/sr), so seconds are pts/sr; and bin `b` sits at
// b*sr/(2*nb) Hz.
//
// Region times are absolute seconds in the source file (like the noise
// reduction sample), so a region stays on the same event when the loop is
// re-trimmed. The expression is built against the trimmed read, which starts
// at t=0 at loopStart - regions are shifted by -loopStart here, and ones
// entirely outside the loop are dropped.

export const MAX_SPECTRAL_REPAIRS = 24
const MIN_HZ = 20
const MAX_HZ = 22050
const DEFAULT_REDUCTION_DB = 40
const MAX_REDUCTION_DB = 80

function finite(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// Cleans one stored region into { startSec, endSec, lowHz, highHz,
// reductionDb } with its bounds ordered and clamped, or null if it has no
// area (zero length or zero bandwidth) or turns nothing down.
export function normalizeSpectralRepair(region) {
  if (!region || typeof region !== 'object') return null
  const a = finite(region.startSec, NaN)
  const b = finite(region.endSec, NaN)
  const lo = Math.min(Math.max(finite(region.lowHz, NaN), MIN_HZ), MAX_HZ)
  const hi = Math.min(Math.max(finite(region.highHz, NaN), MIN_HZ), MAX_HZ)
  if (![a, b, lo, hi].every(Number.isFinite)) return null
  const reductionDb = Math.min(Math.max(finite(region.reductionDb, DEFAULT_REDUCTION_DB), 0), MAX_REDUCTION_DB)
  const startSec = Math.max(0, Math.min(a, b))
  const endSec = Math.max(a, b)
  const lowHz = Math.min(lo, hi)
  const highHz = Math.max(lo, hi)
  if (endSec - startSec < 0.005 || highHz - lowHz < 1 || reductionDb <= 0) return null
  return { startSec, endSec, lowHz, highHz, reductionDb }
}

function fmt(n) {
  return Number(n.toFixed(6)).toString()
}

// Builds the afftfilt fragment for the regions that overlap
// [loopStart, loopEnd), or null when none do. Each region contributes one
// factor (1 - inTime*inBand*(1-gain)); overlapping boxes multiply, so two
// -20dB boxes over the same spot give -40dB there.
export function buildSpectralRepairFilter(regions, loopStart, loopEnd) {
  if (!Array.isArray(regions) || regions.length === 0) return null
  const factors = []
  for (const raw of regions.slice(0, MAX_SPECTRAL_REPAIRS)) {
    const region = normalizeSpectralRepair(raw)
    if (!region) continue
    const t0 = Math.max(region.startSec, loopStart) - loopStart
    const t1 = Math.min(region.endSec, loopEnd) - loopStart
    if (t1 - t0 < 0.005) continue
    const loss = 1 - Math.pow(10, -region.reductionDb / 20)
    factors.push(
      `(1-between(pts/sr,${fmt(t0)},${fmt(t1)})*between(b*sr/(2*nb),${fmt(region.lowHz)},${fmt(region.highHz)})*${fmt(loss)})`
    )
  }
  if (factors.length === 0) return null
  const gain = factors.join('*')
  return `afftfilt=real='re*${gain}':imag='im*${gain}'`
}
