import { spawn } from 'node:child_process'
import { resolveYtDlpPath } from './ytDlpPath.js'
import { parseFfmpegProgress } from './ffmpegProgress.js'
import { ytDlpErrorMessage } from './errorMessage.js'

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
//
// `totalSeconds` covers the case yt-dlp's own percent can't: with
// --download-sections yt-dlp hands the download to ffmpeg, which streams the
// section through and prints nothing yt-dlp turns into a percent - the only
// `[download] 100%` line arrives once the whole thing is already finished.
// YouTube throttles most long ambience uploads to roughly playback speed
// (measured 2026-09-21: 32 KiB/s, so a 10-minute section really does take
// about five minutes), so without this the UI sits on one frozen line for
// minutes and looks hung. ffmpeg's own `time=` clock on stderr is the real
// progress signal; against a known section length it becomes a percent.
// `onChild` hands the caller the process so a long download can be cancelled.
export function runYtDlp(args, { onProgress, onStatus, totalSeconds = 0, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true })
    onChild?.(child)
    let stderrTail = ''
    // Highest percent seen so far. Each stage restarts its own clock (the
    // ExtractAudio pass replays ffmpeg's `time=` from zero right after the
    // download finished at 100%), so progress is kept monotonic rather than
    // bouncing back to the start.
    let highestPercent = 0
    const report = (percent) => {
      if (!onProgress || !Number.isFinite(percent)) return
      const clamped = Math.max(0, Math.min(100, percent))
      if (clamped <= highestPercent) return
      highestPercent = clamped
      try {
        onProgress(clamped)
      } catch {
        // a progress-callback throw must never break the download
      }
    }

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
      if (totalSeconds > 0) {
        const progress = parseFfmpegProgress(text, totalSeconds)
        if (progress) {
          report(progress.percent)
          if (progress.etaText && onStatus) {
            try {
              onStatus(`Downloading — about ${progress.etaText} left (YouTube limits the speed on long videos).`)
            } catch {
              // a status-callback throw must never break the download
            }
          }
        }
      }
    })

    if (onProgress || onStatus) {
      let lineBuf = ''
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        if (onProgress) {
          const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(text)
          if (match) report(Number(match[1]))
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
      else reject(new Error(ytDlpErrorMessage(stderrTail, `yt-dlp stopped with code ${code}.`)))
    })
  })
}
