// Parallel final mix + Opus encode for long exports. The final step used to
// be one mix process feeding one encoder, each on a single thread: on 1 h of
// the owner's Beach preset the mix alone took 22 s (it decodes every
// overlapping track) and the Opus encode 36 s. Here the export is cut into
// time windows; each window gets its own mix process (reading only the
// tracks it overlaps) piped into its own encoder, several windows at once,
// and the windows' Opus packets are stitched into one Ogg Opus file.
//
// Opus carries state from frame to frame, so a window can't be encoded
// cold. Each window also mixes and encodes PAD_SAMPLES of audio before and
// after itself; the packets for that extra audio are dropped. This is the
// "priming" approach (the opus-pure crate's parallel encoder; Valin on the
// Opus list, 2017). Measured on 1 h of the Beach mix: the seams sit inside
// a single-pass encode's own frame-to-frame variation (seam SNR within
// 0.3 dB of it). The pad also lets the window's resampler and whole-mix
// filters settle before the part that is kept.
import fs from 'node:fs'
import { runFfmpegChain } from './runFfmpeg.js'
import { readOggPackets, createOggOpusWriter, opusPacketSamples, OPUS_RATE } from './oggOpus.js'
import { mapPool } from './mapPool.js'

const FRAME_SAMPLES = 960 // libopus' default 20 ms frame at 48 kHz
export const PAD_SAMPLES = OPUS_RATE // 1 s, a whole number of frames
const MAX_WINDOW_SECONDS = 300
const MIN_WINDOW_SECONDS = 60

// Window boundaries in 48 kHz samples: [{ start, end, padStart, padEnd }].
// Every boundary is a whole number of Opus frames (960 samples, which is
// also exactly 882 samples at the mix's 44.1 kHz). The window count is a
// multiple of `concurrency` so no round leaves encoders idle; windows stay
// at most MAX_WINDOW_SECONDS and, when the export allows, at least
// MIN_WINDOW_SECONDS long.
export function planWindows(totalSamples, concurrency) {
  const slots = Math.max(1, concurrency)
  const rounds = Math.ceil(totalSamples / (slots * MAX_WINDOW_SECONDS * OPUS_RATE))
  const count = Math.max(1, Math.min(slots * rounds, Math.floor(totalSamples / (MIN_WINDOW_SECONDS * OPUS_RATE))))
  const length = Math.ceil(totalSamples / count / FRAME_SAMPLES) * FRAME_SAMPLES
  const windows = []
  for (let start = 0; start < totalSamples || windows.length === 0; start += length) {
    const end = Math.min(totalSamples, start + length)
    windows.push({ start, end, padStart: Math.max(0, start - PAD_SAMPLES), padEnd: Math.min(totalSamples, end + PAD_SAMPLES) })
  }
  return windows
}

// Packets of one encoded window that belong to the final stream: drops the
// lead-in pad's packets and keeps the window's own (all the rest for the
// last window, whose tail the final granule trims).
export function windowPackets(audioPackets, win, isLast) {
  const drop = (win.start - win.padStart) / FRAME_SAMPLES
  const keep = isLast ? audioPackets.length - drop : (win.end - win.start) / FRAME_SAMPLES
  const kept = audioPackets.slice(drop, drop + keep)
  if (keep <= 0 || kept.length < keep || kept.some((p) => opusPacketSamples(p) !== FRAME_SAMPLES)) {
    throw new Error('Parallel Opus encode: a window came back with unexpected packets')
  }
  return kept
}

// mixArgsFor(win) returns the ffmpeg args (inputs, graph, -map, -t; no
// output args) that mix exactly [win.padStart, win.padEnd) of the export.
// Writes the Opus file at outputPath; tempPath(ext) names scratch files.
export async function mixToOpusInParallel({ mixArgsFor, codecArgs, durationSeconds, outputPath, concurrency, tempPath, onProgress }) {
  const totalSamples = Math.round(durationSeconds * OPUS_RATE)
  const windows = planWindows(totalSamples, concurrency)
  const oggPaths = windows.map(() => tempPath('ogg'))
  const doneSeconds = windows.map(() => 0)
  const report = (i, seconds) => {
    const win = windows[i]
    const core = (win.end - win.start) / OPUS_RATE
    doneSeconds[i] = Math.min(core, Math.max(doneSeconds[i], seconds - (win.start - win.padStart) / OPUS_RATE))
    onProgress?.(doneSeconds.reduce((a, b) => a + b, 0))
  }
  try {
    await mapPool(windows, concurrency, async (win, i) => {
      await runFfmpegChain(
        [...mixArgsFor(win), '-c:a', 'pcm_f32le', '-ar', String(OPUS_RATE), '-ac', '2', '-f', 'nut', 'pipe:1'],
        ['-y', '-f', 'nut', '-i', 'pipe:0', ...codecArgs, '-ar', String(OPUS_RATE), '-ac', '2', '-f', 'ogg', oggPaths[i]],
        { onProgress: (seconds) => report(i, seconds) }
      )
      report(i, Infinity)
    })

    const out = fs.openSync(outputPath, 'w')
    try {
      let writer = null
      for (let i = 0; i < windows.length; i++) {
        const packets = readOggPackets(fs.readFileSync(oggPaths[i]))
        writer ??= createOggOpusWriter({ head: packets[0], tags: packets[1], write: (buf) => fs.writeSync(out, buf) })
        for (const p of windowPackets(packets.slice(2), windows[i], i === windows.length - 1)) await writer.add(p)
        fs.rmSync(oggPaths[i], { force: true })
      }
      await writer.end(totalSamples)
    } finally {
      fs.closeSync(out)
    }
  } finally {
    for (const p of oggPaths) fs.rmSync(p, { force: true })
  }
}
