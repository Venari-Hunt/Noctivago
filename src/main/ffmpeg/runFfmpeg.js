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

// Reported directly: a real multi-hour export died with "ffmpeg exited with
// code 4294967268: <a wall of raw ffmpeg progress/stderr text>" - technically
// complete (the actual cause, "No space left on device", was right there in
// the stderr tail) but unreadable to a non-developer at a glance, and the
// exit code itself is a Windows unsigned-wraparound rendering of ffmpeg's own
// signed code (4294967268 = 2^32 - 28) that means nothing to anyone. Rather
// than reformat every ffmpeg error message, recognize the handful of known,
// actionable failure signatures ffmpeg itself already prints to stderr and
// lead the message with a plain sentence - the full technical detail stays
// appended afterward, never hidden, just no longer the first (and only)
// thing a non-technical reader sees. Centralized here rather than in
// exportMix.js alone since any ffmpeg call in the app (loop-clip bakes,
// waveform analysis, reverb, composite bakes) can hit the same disk-full
// condition, not just a long export's own final mixdown.
const FRIENDLY_FFMPEG_ERRORS = [
  { pattern: /no space left on device/i, message: 'Not enough free disk space to finish writing the file.' },
  {
    pattern: /(HTTP error 4\d\d|Server returned \d\d\d [A-Za-z])/i,
    message: 'That link could not be opened - it may be a dead link, need a login, or not point at a media file.'
  }
]

function ffmpegError(code, stderrTail) {
  const detail = `ffmpeg exited with code ${code}: ${stderrTail}`
  const known = FRIENDLY_FFMPEG_ERRORS.find(({ pattern }) => pattern.test(stderrTail))
  return new Error(known ? `${known.message} (${detail})` : detail)
}

// ffmpeg writes progress to stderr as `... time=HH:MM:SS.ms ...` lines
// (carriage-return separated). Pull the most recent one out of a chunk so a
// long render can report how far through the output it is.
const TIME_RE = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g

function latestProgressSeconds(text) {
  let match
  let last = null
  while ((match = TIME_RE.exec(text)) !== null) last = match
  TIME_RE.lastIndex = 0
  if (!last) return null
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
}

// Runs ffmpeg to completion, ignoring stdout (used for operations that write
// their result to a file passed in `args`, e.g. -y ... output.wav).
// `onProgress(outputSeconds)` fires as the render advances, if given.
export function runFfmpegToFile(args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true })
    const getStderrTail = captureStderrTail(child.stderr)

    if (onProgress) {
      child.stderr.on('data', (chunk) => {
        const seconds = latestProgressSeconds(chunk.toString())
        if (seconds != null) {
          try {
            onProgress(seconds)
          } catch {
            // a progress-callback throw must never break the render
          }
        }
      })
    }

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(ffmpegError(code, getStderrTail()))
    })
  })
}

// Runs ffmpeg with raw input written to its stdin by `feed(write)`, where
// `write(buffer)` resolves once ffmpeg has room for more (honoring
// backpressure) and rejects if ffmpeg has already exited. Used where the
// audio is generated in JS rather than read from a file (exportMix.js's
// varispeed drift). `onProgress` works the same as runFfmpegToFile's.
export function runFfmpegWithStdin(args, feed, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true })
    const getStderrTail = captureStderrTail(child.stderr)
    let exited = false
    let exitError = null

    if (onProgress) {
      child.stderr.on('data', (chunk) => {
        const seconds = latestProgressSeconds(chunk.toString())
        if (seconds != null) {
          try {
            onProgress(seconds)
          } catch {
            // a progress-callback throw must never break the render
          }
        }
      })
    }

    const exitWaiters = new Set()
    // An early ffmpeg exit makes further stdin writes fail with EPIPE - the
    // real error is the exit code/stderr, reported from 'close' below.
    child.stdin.on('error', () => {})
    child.on('error', (err) => {
      exitError = err
      exited = true
      for (const w of exitWaiters) w()
    })
    child.on('close', (code) => {
      exited = true
      if (code !== 0 && !exitError) exitError = ffmpegError(code, getStderrTail())
      for (const w of exitWaiters) w()
      if (exitError) reject(exitError)
      else resolve()
    })

    const write = (buf) =>
      new Promise((res, rej) => {
        if (exited) return rej(exitError ?? new Error('ffmpeg exited before its input was fully written'))
        if (child.stdin.write(buf)) return res()
        const onDrain = () => {
          exitWaiters.delete(onExit)
          res()
        }
        const onExit = () => {
          child.stdin.off('drain', onDrain)
          rej(exitError ?? new Error('ffmpeg exited before its input was fully written'))
        }
        child.stdin.once('drain', onDrain)
        exitWaiters.add(onExit)
      })

    Promise.resolve()
      .then(() => feed(write))
      .then(() => child.stdin.end())
      .catch((err) => {
        // Generation failed (or ffmpeg died mid-feed): stop ffmpeg, surface
        // whichever error is more informative.
        if (!exited) {
          exitError = err
          child.kill()
        }
      })
  })
}

// Runs ffmpeg and streams stdout chunk-by-chunk via onChunk, never buffering
// the whole output — used for piping raw PCM out for waveform extraction.
export function runFfmpegPipe(args, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, { windowsHide: true })
    const getStderrTail = captureStderrTail(child.stderr)

    // onChunk runs synchronously inside the stdout stream's own 'data' emit
    // - a throw in there propagates straight up through Node's stream
    // internals as an uncaught main-process exception (confirmed via a real
    // crash: Electron's "JavaScript error in the main process" dialog,
    // re-triggered on every subsequent chunk since the ffmpeg child was
    // never killed and kept streaming). That bypasses every caller's own
    // try/catch around this promise entirely, since the throw happens well
    // after this executor has already returned. Caught here and turned into
    // a normal rejection instead, with the child killed so a bad chunk
    // can't keep re-triggering itself forever.
    child.stdout.on('data', (chunk) => {
      try {
        onChunk(chunk)
      } catch (err) {
        child.kill()
        reject(err)
      }
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(ffmpegError(code, getStderrTail()))
    })
  })
}
