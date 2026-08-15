import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getPluginDir } from './registry.js'

const MIME_TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
}

// Serves a plugin's own files as real ES modules (plugin://<id>/<path>), so
// the renderer can `import()` them with working relative imports between a
// plugin's own files. Registered as a `standard` scheme in main/index.js
// (must happen before app.whenReady()); this just wires the handler.
export function registerPluginProtocol() {
  protocol.handle('plugin', async (request) => {
    const url = new URL(request.url)
    const id = url.hostname
    const pluginDir = getPluginDir(id)
    if (!pluginDir) return new Response('Not found', { status: 404 })

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const resolved = path.resolve(pluginDir, relativePath)

    // Path-traversal guard: imports can reference sibling files (unlike
    // sound://, which only ever resolves an opaque id), so the resolved
    // path must be explicitly verified to still fall under this plugin's
    // own directory rather than trusted outright.
    const pluginRoot = path.resolve(pluginDir) + path.sep
    if (!resolved.startsWith(pluginRoot)) {
      return new Response('Forbidden', { status: 403 })
    }

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return new Response('Not found', { status: 404 })
    }

    const mimeType = MIME_TYPES[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream'
    const data = await fs.promises.readFile(resolved)
    return new Response(data, { headers: { 'Content-Type': mimeType, 'Access-Control-Allow-Origin': '*' } })
  })
}
