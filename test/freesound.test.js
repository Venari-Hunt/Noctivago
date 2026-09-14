import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// __FREESOUND_API_KEY__ is normally a build-time constant (electron.vite.
// config.js's `define`, main process only) - under plain `node --test` there
// is no bundler substituting it, so it has to be stubbed as a real global
// before any of client.js's functions are actually called. Safe to do after
// the (hoisted) import below: every reference to it in client.js lives
// inside a function body, evaluated only when that function runs, not at
// module-load time.
globalThis.__FREESOUND_API_KEY__ = 'test-token'

const { authorizedPreviewUrl, isFreesoundAvailable, searchSounds } = await import('../src/main/freesound/client.js')

describe('authorizedPreviewUrl', () => {
  test('appends the token to a real freesound.org URL', () => {
    const result = authorizedPreviewUrl('https://freesound.org/data/previews/1/123_preview-hq.mp3')
    assert.ok(result.includes('token=test-token'))
  })

  test('accepts a freesound.org subdomain (the preview CDN)', () => {
    const result = authorizedPreviewUrl('https://cdn.freesound.org/previews/123_preview-hq.mp3')
    assert.ok(result.startsWith('https://cdn.freesound.org/'))
    assert.ok(result.includes('token=test-token'))
  })

  // The SSRF guard: authorizedPreviewUrl is the one place a real API token
  // gets attached to a URL, and every one of its callers (the ffmpeg
  // download, the freesound-preview:// proxy) ultimately traces back to a
  // URL string that started life inside a Freesound API JSON response - but
  // defense in depth matters here, since a bug elsewhere letting an
  // arbitrary URL reach this function would otherwise leak the token to it.
  test('rejects a non-Freesound URL', () => {
    assert.throws(() => authorizedPreviewUrl('https://evil.example.com/steal'), /Not a Freesound URL/)
  })

  test('rejects a lookalike hostname (no real subdomain relationship)', () => {
    assert.throws(() => authorizedPreviewUrl('https://notfreesound.org/x.mp3'))
    assert.throws(() => authorizedPreviewUrl('https://freesound.org.evil.com/x.mp3'))
  })
})

describe('isFreesoundAvailable', () => {
  test('true when the build-time key is set', () => {
    assert.equal(isFreesoundAvailable(), true)
  })

  test('false when the key is empty (unconfigured build)', () => {
    globalThis.__FREESOUND_API_KEY__ = ''
    assert.equal(isFreesoundAvailable(), false)
    globalThis.__FREESOUND_API_KEY__ = 'test-token'
  })
})

describe('searchSounds', () => {
  test('a blank query short-circuits to an empty result with no network call', async () => {
    const result = await searchSounds({ query: '   ' })
    assert.deepEqual(result, { ok: true, results: [], count: 0, hasMore: false })
  })

  test('an unconfigured build fails fast instead of calling out with an empty token', async () => {
    globalThis.__FREESOUND_API_KEY__ = ''
    const result = await searchSounds({ query: 'rain' })
    assert.equal(result.ok, false)
    globalThis.__FREESOUND_API_KEY__ = 'test-token'
  })

  // Reported directly (inbox 2026-09-14): a Freesound 502 came back as a
  // full HTML error page, which got dumped verbatim (truncated to 200 chars
  // of raw <!doctype html>...) straight into the Search Freesound dialog's
  // status line - a real bug, not a display-cosmetics nitpick, since it left
  // the user staring at markup instead of a readable message.
  test('a 5xx HTML error page never leaks raw markup into the error message', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response('<!doctype html><html><head><title>Server Error</title></head></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' }
      })
    try {
      const result = await searchSounds({ query: 'rain' })
      assert.equal(result.ok, false)
      assert.ok(!result.error.includes('<'), `error should not contain raw markup: ${result.error}`)
      assert.match(result.error, /502/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
