// A tiny stand-in for the community server (community/ in this repo, a Cloudflare Worker),
// so the Community plugin can be driven without the network or a real account.
// Serves one preset; the bundle bytes are set by the test. Uploads are recorded, not stored.
import http from 'node:http'

export async function startFakeCommunity() {
  const state = { bundle: Buffer.alloc(0), uploads: [], hits: [] }
  const id = 'a'.repeat(32)
  const preset = () => ({
    id,
    name: 'Fake rain',
    author: 'Tester',
    description: 'A preset served by the e2e fake server.',
    tags: ['rain'],
    soundCount: 1,
    durationSeconds: 2,
    sizeBytes: state.bundle.length,
    downloads: 3,
    appVersion: '0.1.277',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  const send = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    state.hits.push(`${req.method} ${url.pathname}`)
    if (url.pathname === '/v1/presets' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const hit = !q || 'fake rain tester rain'.includes(q)
      return send(res, 200, { ok: true, results: hit ? [preset()] : [], hasMore: false })
    }
    if (url.pathname === '/v1/presets/mine') return send(res, 200, { ok: true, results: state.uploads.map((u) => ({ ...preset(), ...u, hidden: false })) })
    if (url.pathname === `/v1/presets/${id}/bundle`) {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': state.bundle.length })
      return res.end(state.bundle)
    }
    if (url.pathname === '/v1/presets' && req.method === 'POST') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      return req.on('end', () => {
        const text = Buffer.concat(chunks).toString('latin1')
        const name = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? 'Uploaded'
        const up = { id: 'b'.repeat(32), name }
        state.uploads.push(up)
        send(res, 201, { ok: true, preset: { ...preset(), ...up } })
      })
    }
    send(res, 404, { ok: false, error: 'Not found.' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}
