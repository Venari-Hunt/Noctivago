import { spawn } from 'node:child_process'
import { resolveFfmpegPath } from './ffmpegPath.js'

const STDERR_TAIL_CHARS = 4000

function captureStderrTail(stream) {
  let tail = ''
  stream.on('data', (chunk) => {
    tail += chunk.toString()
    if (tail.length > STDERR_TAIL_CHARS) tail = tail.slice(-STDERR_TAIL_CHARS)
  })
  return () => tail
}

// Runs ffmpeg to completion, ignoring stdout (used for operations that write
// their result to a file passed in `args`, e.g. -y ... output.wav).
export function runFfmpegToFile(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true })
    const getStderrTail = captureStderrTail(child.stderr)

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}: ${getStderrTail()}`))
    })
  })
}

// Runs ffmpeg and streams stdout chunk-by-chunk via onChunk, never buffering
// the whole output — used for piping raw PCM out for waveform extraction.
export function runFfmpegPipe(args, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true })
    const getStderrTail = captureStderrTail(child.stderr)

    child.stdout.on('data', onChunk)
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with code ${code}: ${getStderrTail()}`))
    })
  })
}
