import { normalizePan, stereoPanMatrix } from '../../shared/pan.js'

// Stereo pan (v0.1.216) as an ffmpeg `pan` filter, using the same pan law as
// the live Mixer (src/shared/pan.js). Kept Electron-free so
// test/panFilter.test.js can import it directly.
//
// The live chain up-mixes a mono source to L = R = M at full level before
// panning. ffmpeg's own mono->stereo conversion is -3 dB, so a mono input
// gets its own explicit coefficients (each output row summed) instead of
// relying on `aformat`. More than two channels are downmixed to stereo
// first, then panned like stereo.

export { normalizePan, stereoPanMatrix }

const fmt = (n) => (Math.abs(n) < 1e-12 ? 0 : n).toFixed(8)

// channels: the input's channel count (1 = mono). Returns null for a
// centered pan, so an unpanned sound's render stays byte-identical.
export function buildPanFilter(pan, channels) {
  const p = normalizePan(pan)
  if (p === 0) return null
  const [[ll, lr], [rl, rr]] = stereoPanMatrix(p)
  if (channels === 1) {
    return `pan=stereo|c0=${fmt(ll + lr)}*c0|c1=${fmt(rl + rr)}*c0`
  }
  return `aformat=channel_layouts=stereo,pan=stereo|c0=${fmt(ll)}*c0+${fmt(lr)}*c1|c1=${fmt(rl)}*c0+${fmt(rr)}*c1`
}

// Parses the channel count out of ffmpeg's "Stream #0:0 ... Audio: ..., 44100
// Hz, mono, s16" stderr line. Unknown layouts count as stereo-or-more.
export function parseChannelCount(stderr) {
  const match = String(stderr).match(/Stream #0:\d+[^\n]*Audio:[^\n]*?\d+\s*Hz,\s*([^,\n]+)/)
  if (!match) return null
  const layout = match[1].trim()
  if (layout === 'mono' || layout === '1 channels') return 1
  const n = layout.match(/^(\d+) channels/)
  return n ? Number(n[1]) : 2
}
