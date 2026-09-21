import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { resolveYtDlpPath, isYtDlpAvailable } from './ytDlpPath.js'
import { getSettings } from '../settings.js'
import { clampPageSize } from '../../shared/pageSize.js'
import { parseYouTubeSearchResults } from './searchResults.js'

// YouTube search for the Browse Sounds tab (research pass 2026-09-15,
// see the Board / CLAUDE.md): the official YouTube Data API's quota is
// per-project, not per-user - a single app-wide key (the Freesound model)
// would cap this app's *entire userbase combined* at ~100 searches/day, a
// non-starter. The bundled yt-dlp binary (already shipped for "Add from
// link"'s video-site fallback since v0.1.132) can search with no key and no
// quota at all, by working the same way the site itself does rather than
// calling Google's API - same bot-detection/ToS risk class already accepted
// for that existing download fallback, just applied to browsing instead of
// resolving one URL the user already has.
//
// `--flat-playlist --dump-json` returns one NDJSON line per result with
// everything a card needs (title, duration, channel, thumbnails,
// description, watch URL) already in one call - verified against the real
// bundled binary before writing this (2.2s for 20 results); no second
// per-video yt-dlp call needed, unlike a naive read of yt-dlp's docs might
// suggest. `--playlist-start`/`--playlist-end` against a larger `ytsearchN:`
// count works as a genuine offset (verified directly), which is what gives
// "page 2" a real meaning here - YouTube search has no cursor/token the way
// Freesound's API does, so each page re-runs the search up through its own
// end index rather than continuing from a saved cursor. This re-scrapes the
// earlier results too on every later page, which is fine at the scale an
// interactive ambient-sound search realistically reaches (a handful of
// pages), and keeps this module fully stateless between calls.
const SEARCH_TIMEOUT_MS = 25_000

export function isYouTubeSearchAvailable() {
  return isYtDlpAvailable()
}

export async function searchYouTube({ query, page = 1, pageSize = 12 } = {}) {
  // Same wording as library.js's addSoundFromUrl - "missing from this build"
  // pointed at the wrong culprit, since the installer does ship it; on a real
  // install something removed it, usually antivirus.
  if (!isYtDlpAvailable()) {
    return {
      ok: false,
      error: 'The YouTube downloader (yt-dlp.exe) is missing from this install. Antivirus software often quarantines it by mistake — check its quarantine and allow it, then reinstall Noctívago.'
    }
  }
  const q = (query ?? '').trim()
  if (!q) return { ok: true, results: [], hasMore: false }

  const size = clampPageSize(pageSize, 12)
  const pageNum = Math.max(Math.round(page) || 1, 1)
  const start = (pageNum - 1) * size + 1
  const end = pageNum * size

  const args = [
    `ytsearch${end}:${q}`,
    '--flat-playlist',
    '--dump-json',
    '--no-warnings',
    '--playlist-start',
    String(start),
    '--playlist-end',
    String(end)
  ]
  // Same opt-in cookie setting "Add from link" already uses for YouTube's
  // bot-detection ("Sign in to confirm you're not a bot") - search hits the
  // same anti-bot wall a plain extraction can, so reusing it here rather
  // than adding a second, parallel cookie setting just for search.
  const cookiesBrowser = getSettings().ytDlpCookiesBrowser
  if (cookiesBrowser && cookiesBrowser !== 'none') args.push('--cookies-from-browser', cookiesBrowser)

  try {
    const stdout = await runAndCapture(args)
    const { results, hasMore } = parseYouTubeSearchResults(stdout, size)
    return { ok: true, results, hasMore }
  } catch (err) {
    log.error('YouTube search failed', err)
    return { ok: false, error: 'YouTube search failed - try again shortly.' }
  }
}

function runAndCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveYtDlpPath(), args, { windowsHide: true })
    let stdout = ''
    let stderrTail = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('YouTube search timed out'))
    }, SEARCH_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString()
      if (stderrTail.length > 2000) stderrTail = stderrTail.slice(-2000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`yt-dlp search exited with code ${code}: ${stderrTail || 'no error output'}`))
    })
  })
}
