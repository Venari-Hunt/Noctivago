import { runFfmpegPipe } from './runFfmpeg.js'

const SAMPLE_RATE = 4000

// Streams the whole file through ffmpeg as downsampled mono float32 PCM and
// reduces it into [min,max] peaks per pixel column as the data arrives —
// never buffers the decoded audio, so this works for files of any length
// without the memory blowup that broke long-file decodeAudioData earlier.
export async function extractWaveformPeaks({ inputPath, durationSeconds, targetWidth }) {
  if (!Number.isInteger(targetWidth) || targetWidth < 1) {
    throw new Error(`extractWaveformPeaks: invalid targetWidth ${targetWidth}`)
  }
  const totalSamples = Math.max(1, Math.round(durationSeconds * SAMPLE_RATE))
  const samplesPerBucket = Math.max(1, Math.floor(totalSamples / targetWidth))

  const peaks = Array.from({ length: targetWidth }, () => [0, 0])
  let sampleIndex = 0
  let leftover = Buffer.alloc(0)

  const args = [
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', String(SAMPLE_RATE),
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    'pipe:1'
  ]

  await runFfmpegPipe(args, (chunk) => {
    const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
    const usableLength = combined.length - (combined.length % 4)
    leftover = combined.subarray(usableLength)

    for (let offset = 0; offset < usableLength; offset += 4) {
      const value = combined.readFloatLE(offset)
      const bucket = Math.min(targetWidth - 1, Math.floor(sampleIndex / samplesPerBucket))
      const peak = peaks[bucket]
      if (value < peak[0]) peak[0] = value
      if (value > peak[1]) peak[1] = value
      sampleIndex++
    }
  })

  return peaks
}
