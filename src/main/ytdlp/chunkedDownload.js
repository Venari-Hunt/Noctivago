import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { resolveYtDlpPath } from './ytDlpPath.js'
import { mapPool } from '../ffmpeg/mapPool.js'
import { bytesForSeconds, planChunks, isRangeFetchable } from './chunkPlan.js'

// Fast path for "Add from link" on YouTube and similar sites. YouTube serves
// the first ~3 MB of any single request at full speed, then throttles that
// request to about playback speed (measured 2026-09-27: one 12 MB request
// crawled at 36 KB/s, while the same 12 MB as twelve 1 MB requests, 4 at a
// time, took 2.9 s). yt-dlp's --download-sections hands the transfer to
// ffmpeg, which reads one long request, so it always hit the throttle.
//
// Here yt-dlp only resolves the audio stream's direct URL; the bytes the
// first N minutes need are fetched in CHUNK_BYTES ranges, CONCURRENCY at a
// time, and ffmpeg converts the partial file (a truncated webm/m4a decodes
// fine up to where it stops - checked for YouTube's 251 and 140 formats).
// Any surprise throws, and the caller falls back to the plain yt-dlp path.

const CONCURRENCY = 4
const CHUNK_RETRIES = 2
const CHUNK_TIMEOUT_MS = 30_000

function resolveFormat(url, { cookiesBrowser, onChild, signal }) {
  return new Promise((resolve, reject) => {
    const args = ['--no-playlist', '-f', 'bestaudio', '-j']
    if (cookiesBrowser && cookiesBrowser !== 'none') args.push('--cookies-from-browser', cookiesBrowser)
    args.push(url)
    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true })
    onChild?.(child)
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (signal?.aborted) return reject(new Error('Download cancelled.'))
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `yt-dlp exited with ${code}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('yt-dlp returned no format info.'))
      }
    })
  })
}

async function fetchChunk(url, headers, { start, end }, signal) {
  let lastErr
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt += 1) {
    if (signal.aborted) throw new Error('Download cancelled.')
    try {
      const res = await fetch(url, {
        headers: { ...headers, Range: `bytes=${start}-${end}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(CHUNK_TIMEOUT_MS)])
      })
      // Past the end of a file whose size was only estimated: nothing left.
      if (res.status === 416) return Buffer.alloc(0)
      // A 200 means the server ignored the range and would send the whole
      // file; the plain yt-dlp path handles that better.
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

// Downloads the first `maxSeconds` (0 = all) of `url`'s best audio into
// `outPath` (the source container, not yet converted). onProgress(0..1).
// Throws when the fast path doesn't apply; the caller falls back.
export async function downloadChunked(url, outPath, { maxSeconds = 0, cookiesBrowser, onProgress, onChild, signal }) {
  const info = await resolveFormat(url, { cookiesBrowser, onChild, signal })
  if (!isRangeFetchable(info)) throw new Error(`Format ${info.format_id} can't be range-fetched (${info.protocol}).`)
  const total = bytesForSeconds(info, maxSeconds)
  if (!total) throw new Error('Unknown file size.')

  const chunks = planChunks(total)
  const fd = fs.openSync(outPath, 'w')
  let received = 0
  try {
    await mapPool(chunks, CONCURRENCY, async (chunk) => {
      const buf = await fetchChunk(info.url, info.http_headers ?? {}, chunk, signal)
      fs.writeSync(fd, buf, 0, buf.length, chunk.start)
      received += buf.length
      onProgress?.(Math.min(1, received / total))
    })
  } finally {
    fs.closeSync(fd)
  }
  return { title: info.title ?? null, ext: info.ext ?? null }
}
