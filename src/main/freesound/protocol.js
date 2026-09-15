import { protocol } from 'electron'
import log from 'electron-log/main'
import { authorizedPreviewUrl } from './client.js'

// Lets the Browse Sounds plugin (plugins/browse-sounds/, formerly the
// core add-sound-menu dialog this moved out of in v0.1.204) audition a
// result before importing it, without the API token ever
// reaching the sandboxed renderer - same "everything served
// through a custom protocol rather than raw access" pattern sound:// and
// plugin:// already establish (see CLAUDE.md's Plugins section). The
// renderer only ever sees the plain (unauthenticated) preview URL Freesound
// itself returned from search; this handler re-derives the authorized
// (token-appended) URL server-side and proxies the real request, so the key
// stays main-process-only. authorizedPreviewUrl's own hostname check is the
// only thing standing between this and an open proxy - keep it that way.
export function registerFreesoundPreviewProtocol() {
  protocol.handle('freesound-preview', async (request) => {
    const url = new URL(request.url)
    const encoded = url.pathname.replace(/^\/+/, '')
    let target
    try {
      target = authorizedPreviewUrl(decodeURIComponent(encoded))
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    try {
      const range = request.headers.get('range')
      const upstream = await fetch(target, { headers: range ? { range } : undefined })
      const headers = new Headers(upstream.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (err) {
      log.error('freesound-preview:// proxy failed', err)
      return new Response('Upstream error', { status: 502 })
    }
  })
}
