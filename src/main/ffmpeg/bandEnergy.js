import { spawn } from 'node:child_process'
import { runFfmpegPipe } from './runFfmpeg.js'
import { resolveFfmpegPath } from './ffmpegPath.js'

// Sample rate for the piped PCM below - only ever used to estimate relative
// energy, not for anything that needs real fidelity, so a low rate keeps
// each pass cheap (same reasoning as loopClip.js's PROBE_SAMPLE_RATE).
//
// BUG FIX, caught during verification before this ever shipped: this was
// originally 11025 (Nyquist 5512.5Hz) - comfortably below the 6000Hz and
// 14000Hz bands, so ffmpeg's own anti-aliasing filter during the final
// output resample was silently discarding real signal at those frequencies
// regardless of source file quality. Confirmed directly: a genuinely loud,
// real 14kHz tone (44.1kHz source) measured RMS ~0.00012 (silence) at
// 11025Hz output vs. ~0.25 (correctly strong) at 32000Hz output. 32000Hz
// gives Nyquist=16000Hz, comfortably above the highest band (14000Hz) plus
// its own passband width.
const SAMPLE_RATE = 32000
// Two-octave-wide Butterworth bandpass per band, verified against the real
// bundled ffmpeg binary before writing this (a synthetic tone centered on
// the passband measured ~10x the RMS of the same tone through a bandpass
// centered a few octaves away) - wide enough that six of these roughly tile
// the audible spectrum without huge gaps between them, narrow enough to
// still distinguish "mostly low end" from "mostly high end" content.
const BAND_WIDTH_OCTAVES = 2

// A bandpass filter centered at or above the *source* file's own Nyquist
// frequency is a degenerate/undefined configuration, not just an imprecise
// one - confirmed directly: the same 100Hz-tone test that correctly showed
// near-silence at the 14kHz band for a 44.1kHz source instead showed a
// spuriously HIGH reading (louder than the correctly-detected 80Hz band!)
// for a 22050Hz source, where 14000Hz sits above that file's own 11025Hz
// Nyquist. Rather than trust whatever a degenerate filter configuration
// produces, this probes the source's real sample rate first (parsing it
// straight out of ffmpeg's own stderr, the same "Stream #0:0: Audio: N Hz"
// line format used everywhere ffmpeg reports stream info) and skips any
// band at or past that file's Nyquist entirely - correctly reporting
// silence for a band the source could never have contained, rather than a
// misleading number.
function probeSourceSampleRate(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(), ['-i', inputPath, '-t', '0.01', '-f', 'null', '-'], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', () => {
      const match = stderr.match(/Stream #0:0[^\n]*Audio:[^\n]*?(\d+)\s*Hz/)
      resolve(match ? Number(match[1]) : null)
    })
    child.on('error', () => resolve(null))
  })
}

async function bandRms(inputPath, { loopStart, loopEnd, freqHz }) {
  let sumSquares = 0
  let sampleCount = 0
  await runFfmpegPipe(
    [
      '-ss', loopStart.toFixed(6), '-t', (loopEnd - loopStart).toFixed(6), '-i', inputPath,
      '-af', `bandpass=f=${freqHz}:width_type=o:w=${BAND_WIDTH_OCTAVES}`,
      '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'
    ],
    (chunk) => {
      const usableLength = chunk.length - (chunk.length % 2)
      for (let i = 0; i < usableLength; i += 2) {
        const sample = chunk.readInt16LE(i) / 32768
        sumSquares += sample * sample
        sampleCount++
      }
    }
  )
  return sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0
}

// One bandpass-filtered pass per frequency, run in parallel (wall-clock cost
// is roughly the slowest single pass, not the sum of all of them) - purely
// a static, load-time analysis for the Remix EQ graph's background bars
// (see EqEditor.js), not tied to playback or updated as the user drags
// nodes around. Returns raw RMS values (not yet normalized to 0-1 - the
// caller decides how to scale them for display, since "loud" is relative to
// the loudest band in this particular file, not any fixed absolute value).
// If the sample-rate probe itself fails for any reason (unexpected ffmpeg
// output format, etc.), fails safe by just running every band anyway rather
// than blocking the whole feature over a purely defensive check.
export async function computeBandEnergy(inputPath, { loopStart, loopEnd, freqs }) {
  const sourceSampleRate = await probeSourceSampleRate(inputPath)
  const nyquist = sourceSampleRate ? sourceSampleRate / 2 : Infinity
  return Promise.all(
    freqs.map((freqHz) => (freqHz < nyquist ? bandRms(inputPath, { loopStart, loopEnd, freqHz }) : 0))
  )
}
