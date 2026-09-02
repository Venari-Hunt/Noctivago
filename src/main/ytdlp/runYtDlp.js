import { spawn } from 'node:child_process'
import { resolveYtDlpPath } from './ytDlpPath.js'

const STDERR_TAIL_CHARS = 4000

// Mirrors runFfmpeg.js's own runFfmpegToFile shape (generic arg-list spawn
// wrapper, stderr tail captured for the rejection message) rather than
// depending on a wrapper npm package's own exec API - same reasoning as
// ffmpegPath.js/runFfmpeg.js: only the binary itself is external, the
// process-spawning stays hand-rolled and consistent with the rest of this
// app's ffmpeg integration. onProgress(percent) fires as yt-dlp's own
// `[download]  NN.N%` stdout lines advance (only present with --newline, so
// every caller should pass that).
export function runYtDlp(args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true })
    let stderrTail = ''
    child.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString()
      if (stderrTail.length > STDERR_TAIL_CHARS) stderrTail = stderrTail.slice(-STDERR_TAIL_CHARS)
    })
    if (onProgress) {
      child.stdout.on('data', (chunk) => {
        const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(chunk.toString())
        if (match) {
          try {
            onProgress(Number(match[1]))
          } catch {
            // a progress-callback throw must never break the download
          }
        }
      })
    }
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderrTail || 'no error output'}`))
    })
  })
}
