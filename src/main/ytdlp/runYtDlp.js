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
// every caller should pass that). onStatus(line) fires for yt-dlp's own
// one-off activity lines ([youtube] Extracting URL, [info] Downloading 1
// format(s), [ExtractAudio] Destination, WARNING:/ERROR: ...) minus the
// fast-moving per-percent [download] spam - the "verbose of what's going on"
// the Add-from-link dialog surfaces.
export function runYtDlp(args, { onProgress, onStatus } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true })
    let stderrTail = ''

    // yt-dlp's own activity lines are bracket-prefixed ([youtube], [info],
    // [download] Destination, [ExtractAudio], [Merger], ...) or WARNING:/
    // ERROR:/Deleting. Everything else on the stream is the ffmpeg subprocess
    // yt-dlp spawns dumping its muxing detail (huge signed googlevideo URLs,
    // stream tables) - noise for a "what's going on" log. Keep the former,
    // and always drop the fast-moving [download] NN% progress spam
    // (onProgress owns that).
    // `[out#0/webm @ 0x..]` style lines are ffmpeg's, not yt-dlp's - the `@`
    // inside the brackets tells them apart from `[youtube]` / `[ExtractAudio]`.
    const STATUS_LINE = /^(\[[^\]@]+\]|WARNING:|ERROR:|Deleting\b)/
    const emitStatus = (text) => {
      if (!onStatus) return
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (t && STATUS_LINE.test(t) && !/^\[download\]\s+\d/.test(t)) {
          try {
            onStatus(t)
          } catch {
            // a status-callback throw must never break the download
          }
        }
      }
    }

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderrTail += text
      if (stderrTail.length > STDERR_TAIL_CHARS) stderrTail = stderrTail.slice(-STDERR_TAIL_CHARS)
      emitStatus(text)
    })

    if (onProgress || onStatus) {
      let lineBuf = ''
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        if (onProgress) {
          const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(text)
          if (match) {
            try {
              onProgress(Number(match[1]))
            } catch {
              // a progress-callback throw must never break the download
            }
          }
        }
        if (onStatus) {
          lineBuf += text
          const lines = lineBuf.split(/\r?\n/)
          lineBuf = lines.pop() ?? ''
          emitStatus(lines.join('\n'))
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
