import { runFfmpegPipe } from './runFfmpeg.js'

// Spectrogram for the Remix plugin's Spectral repair panel: a grid of
// `columns` time slices x `rows` log-spaced frequency bands over
// [windowStart, windowEnd) of the file, each cell a 0..255 brightness.
// Streams ffmpeg's mono float PCM through a ring buffer the size of one FFT
// frame and runs one FFT per column as that column's frame completes - flat
// memory for any window length, same reason waveformPeaks.js reduces as it
// streams instead of buffering decoded audio.
//
// Full 44.1kHz (not waveformPeaks' 4kHz) because hiss, buzzes and chirps -
// what this panel exists to find - live up to 20kHz. Brightness is relative
// to the loudest cell, over a DYNAMIC_RANGE_DB floor, so a quiet recording
// still shows its detail. Row 0 is the lowest band.

const SAMPLE_RATE = 44100
const FFT_SIZE = 2048
export const SPECTROGRAM_MIN_HZ = 30
export const SPECTROGRAM_MAX_HZ = 20000
const DYNAMIC_RANGE_DB = 90
const MAX_COLUMNS = 2000
const MAX_ROWS = 512

function hann(n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

// In-place iterative radix-2 FFT; re/im length must be a power of two.
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

// Row r spans [edges[r], edges[r+1]) Hz, log-spaced between min and max.
// Exported so tests (and the plugin's own copy of this mapping) agree on it.
export function spectrogramRowEdges(rows, minHz = SPECTROGRAM_MIN_HZ, maxHz = SPECTROGRAM_MAX_HZ) {
  const edges = new Float64Array(rows + 1)
  const ratio = Math.log(maxHz / minHz)
  for (let r = 0; r <= rows; r++) edges[r] = minHz * Math.exp((ratio * r) / rows)
  return edges
}

export async function extractSpectrogram({ inputPath, windowStart, windowEnd, columns, rows }) {
  if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLUMNS) {
    throw new Error(`extractSpectrogram: invalid columns ${columns}`)
  }
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new Error(`extractSpectrogram: invalid rows ${rows}`)
  }
  if (!(Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowEnd > windowStart)) {
    throw new Error('extractSpectrogram: invalid window')
  }
  const duration = windowEnd - windowStart
  const expectedSamples = Math.max(1, Math.round(duration * SAMPLE_RATE))

  // Column c's frame is centred on its slice of the window; it is analysed
  // once the ring buffer has been filled up to frameEnd[c].
  const frameEnd = new Float64Array(columns)
  for (let c = 0; c < columns; c++) {
    const center = ((c + 0.5) / columns) * expectedSamples
    frameEnd[c] = Math.min(Math.max(Math.round(center + FFT_SIZE / 2), FFT_SIZE), expectedSamples)
  }

  const window = hann(FFT_SIZE)
  const ring = new Float32Array(FFT_SIZE)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  const edges = spectrogramRowEdges(rows)
  const binHz = SAMPLE_RATE / FFT_SIZE
  const db = new Float32Array(columns * rows).fill(-Infinity)
  let sampleIndex = 0
  let nextColumn = 0
  let leftover = Buffer.alloc(0)

  const analyse = (c) => {
    // Oldest sample first: ring position sampleIndex % FFT_SIZE is the next
    // write slot, i.e. the oldest sample still held.
    const start = sampleIndex % FFT_SIZE
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = ring[(start + i) % FFT_SIZE] * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let r = 0; r < rows; r++) {
      const lo = Math.max(1, Math.floor(edges[r] / binHz))
      const hi = Math.min(FFT_SIZE / 2, Math.max(lo, Math.ceil(edges[r + 1] / binHz) - 1))
      let peak = 0
      for (let k = lo; k <= hi; k++) {
        const mag = re[k] * re[k] + im[k] * im[k]
        if (mag > peak) peak = mag
      }
      db[c * rows + r] = peak > 0 ? 10 * Math.log10(peak) : -Infinity
    }
  }

  await runFfmpegPipe(
    [
      '-ss', String(windowStart), '-t', String(duration),
      '-i', inputPath,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'
    ],
    (chunk) => {
      const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = combined.length - (combined.length % 4)
      leftover = combined.subarray(usable)
      for (let offset = 0; offset < usable; offset += 4) {
        ring[sampleIndex % FFT_SIZE] = combined.readFloatLE(offset)
        sampleIndex++
        while (nextColumn < columns && sampleIndex >= frameEnd[nextColumn]) analyse(nextColumn++)
      }
    }
  )
  // The decode can come up a little short of the requested duration (end of
  // file, codec padding) - finish the remaining columns on what arrived.
  while (nextColumn < columns && sampleIndex > 0) analyse(nextColumn++)

  let max = -Infinity
  for (const v of db) if (v > max) max = v
  const values = new Uint8Array(columns * rows)
  if (Number.isFinite(max)) {
    for (let i = 0; i < values.length; i++) {
      const level = (db[i] - (max - DYNAMIC_RANGE_DB)) / DYNAMIC_RANGE_DB
      values[i] = Math.round(Math.min(Math.max(level, 0), 1) * 255)
    }
  }
  return { columns, rows, minHz: SPECTROGRAM_MIN_HZ, maxHz: SPECTROGRAM_MAX_HZ, windowStart, windowEnd, values }
}
