import log from 'electron-log/main'

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
const MAX_PAGE_SIZE = 30

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
  url.searchParams.set('page_size', String(Math.min(Math.max(Math.round(pageSize) || 15, 1), MAX_PAGE_SIZE)))
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
