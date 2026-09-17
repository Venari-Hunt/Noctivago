import log from 'electron-log/main'
import { clampPageSize } from '../../shared/pageSize.js'

// Freesound APIv2 - text search + preview download, both covered by the
// simplest "Token" auth shape (an app-wide key requested once at
// freesound.org/apiv2/apply and baked in at build time, see
// electron.vite.config.js's __FREESOUND_API_KEY__). OAuth2 is only required
// for write actions (upload/rate) or for downloading a sound's full
// original-quality file - this feature only ever needs the compressed
// preview (128kbps mp3, "preview-hq-mp3"), which is plenty for a looping
// ambient sound and keeps the whole feature to one token instead of a
// per-user login flow.
const API_BASE = 'https://freesound.org/apiv2'
const SEARCH_FIELDS = 'id,name,username,previews,duration,license,tags,avg_rating,num_ratings,description'

export function isFreesoundAvailable() {
  return Boolean(__FREESOUND_API_KEY__)
}

export async function searchSounds({ query, page = 1, pageSize = 15, sort = 'score' } = {}) {
  if (!isFreesoundAvailable()) return { ok: false, error: 'Freesound import is not configured in this build.' }
  const q = (query ?? '').trim()
  if (!q) return { ok: true, results: [], count: 0, hasMore: false }

  const url = new URL(`${API_BASE}/search/text/`)
  url.searchParams.set('query', q)
  url.searchParams.set('fields', SEARCH_FIELDS)
  url.searchParams.set('page_size', String(clampPageSize(pageSize, 15)))
  url.searchParams.set('page', String(Math.max(Math.round(page) || 1, 1)))
  url.searchParams.set('sort', sort)
  url.searchParams.set('token', __FREESOUND_API_KEY__)

  try {
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 429) return { ok: false, error: "Freesound's rate limit was hit - try again in a minute." }
      if (res.status >= 500) return { ok: false, error: `Freesound is temporarily unavailable (${res.status}) - try again shortly.` }
      const contentType = res.headers.get('content-type') || ''
      let detail = ''
      if (contentType.includes('json')) {
        const data = await res.json().catch(() => null)
        detail = data?.detail || ''
      }
      return { ok: false, error: `Freesound search failed (${res.status}): ${detail || res.statusText}` }
    }
    const data = await res.json()
    return {
      ok: true,
      count: data.count ?? 0,
      hasMore: Boolean(data.next),
      results: (data.results ?? [])
        .map((r) => ({
          id: r.id,
          name: r.name,
          username: r.username,
          durationSeconds: r.duration,
          license: r.license,
          tags: r.tags ?? [],
          description: r.description ?? '',
          avgRating: r.avg_rating ?? null,
          numRatings: r.num_ratings ?? 0,
          previewUrl: r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3'] || null,
          pageUrl: `https://freesound.org/s/${r.id}/`
        }))
        .filter((r) => r.previewUrl)
    }
  } catch (err) {
    log.error('Freesound search failed', err)
    return { ok: false, error: err.message }
  }
}

// Looks up one sound's current preview URL by id - used when a community
// preset lists a Freesound sound instead of carrying its audio
// (presetPortable.js's finalizeImport). Freesound's own ids are stable, so a
// shared preset can re-fetch the exact same preview the author imported.
export async function getPreviewUrl(freesoundId) {
  if (!isFreesoundAvailable()) throw new Error('Freesound import is not configured in this build.')
  const id = Number(freesoundId)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid Freesound id.')
  const url = new URL(`${API_BASE}/sounds/${id}/`)
  url.searchParams.set('fields', 'id,previews')
  url.searchParams.set('token', __FREESOUND_API_KEY__)
  const res = await fetch(url)
  if (!res.ok) throw new Error(res.status === 404 ? 'That sound was removed from Freesound.' : `Freesound returned ${res.status}.`)
  const body = await res.json()
  const previewUrl = body.previews?.['preview-hq-mp3'] || body.previews?.['preview-lq-mp3']
  if (!previewUrl) throw new Error('Freesound has no preview for that sound.')
  return previewUrl
}

// Credit details for one sound (v0.1.224) - fills in what a hand-downloaded
// file's name can't carry (license) for the export's credits. null when the
// lookup isn't possible; callers keep whatever they already have.
export async function getSoundCredits(freesoundId) {
  const id = Number(freesoundId)
  if (!isFreesoundAvailable() || !Number.isInteger(id) || id <= 0) return null
  const url = new URL(`${API_BASE}/sounds/${id}/`)
  url.searchParams.set('fields', 'id,name,username,license,description,tags')
  url.searchParams.set('token', __FREESOUND_API_KEY__)
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    return {
      title: body.name ?? null,
      username: body.username ?? null,
      license: body.license ?? null,
      description: trimDescription(body.description),
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 15) : []
    }
  } catch (err) {
    log.warn('Freesound credit lookup failed', id, err.message)
    return null
  }
}

// Kept short: it's context for a video description, not an archive.
export function trimDescription(description) {
  const text = String(description ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 400 ? `${text.slice(0, 397)}...` : text
}

// Appends the token as a query param rather than an Authorization header -
// the one auth shape that works identically for every caller of this
// function: ffmpeg's own -i URL fetch (freesound/download.js) can't set
// custom headers as easily as a query string, and the live-preview proxy
// (freesound/protocol.js) forwards a plain URL too. Also acts as an SSRF
// guard: only ever appends the real key to a URL that's actually pointing at
// Freesound's own domain, never to an arbitrary URL a compromised renderer
// might otherwise be able to smuggle through the proxy protocol.
export function authorizedPreviewUrl(previewUrl) {
  const url = new URL(previewUrl)
  if (url.hostname !== 'freesound.org' && !url.hostname.endsWith('.freesound.org')) {
    throw new Error('Not a Freesound URL')
  }
  url.searchParams.set('token', __FREESOUND_API_KEY__)
  return url.toString()
}
