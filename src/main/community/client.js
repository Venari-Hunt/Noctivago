import { app } from 'electron'
import Store from 'electron-store'
import crypto from 'node:crypto'
import log from 'electron-log/main'
import { buildCommunityBundle, MAX_UPLOAD_BYTES } from './bundle.js'
import { prepareImport } from '../presetPortable.js'

// Client for the community presets API (community/ in this repo, a
// Cloudflare Worker). The API URL is baked in at build time
// (__COMMUNITY_API_URL__); an unpackaged dev build can point elsewhere with
// NOCTIVAGO_COMMUNITY_URL (e.g. a local `wrangler dev`).
//
// Identity is a random per-install author key (never shown, never leaves
// this machine except as the X-Author-Key header); the server only stores
// its hash. Losing it only means losing the ability to edit/delete earlier
// uploads.

const store = new Store({
  name: 'community',
  defaults: { authorKey: null, authorName: '' }
})

// A downloaded bundle is read fully into memory before unpacking; the server
// never stores more than MAX_UPLOAD_BYTES per preset.
const MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024

export function apiBase() {
  const override = !app.isPackaged ? process.env.NOCTIVAGO_COMMUNITY_URL : null
  const base = override || __COMMUNITY_API_URL__
  return base ? base.replace(/\/+$/, '') : ''
}

export function isCommunityAvailable() {
  return Boolean(apiBase())
}

function authorKey() {
  let key = store.get('authorKey')
  if (!/^[0-9a-f]{64}$/.test(key || '')) {
    key = crypto.randomBytes(32).toString('hex')
    store.set('authorKey', key)
  }
  return key
}

export function getProfile() {
  return { available: isCommunityAvailable(), authorName: store.get('authorName') }
}

async function request(pathname, { method = 'GET', body, headers = {}, auth = false } = {}) {
  if (!isCommunityAvailable()) return { ok: false, error: 'Community presets are not available in this build.' }
  const finalHeaders = { ...headers }
  if (auth) finalHeaders['x-author-key'] = authorKey()
  let res
  try {
    res = await fetch(`${apiBase()}/v1${pathname}`, { method, body, headers: finalHeaders })
  } catch (err) {
    log.warn('Community request failed', pathname, err)
    return { ok: false, error: "Couldn't reach the community server. Check your connection." }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok || !data?.ok) {
    return { ok: false, status: res.status, error: data?.error || `The community server returned ${res.status}.` }
  }
  return data
}

export function listPresets({ query = '', sort = 'new', page = 1, pageSize = 24 } = {}) {
  const params = new URLSearchParams({ q: String(query), sort: String(sort), page: String(page), pageSize: String(pageSize) })
  return request(`/presets?${params}`)
}

export function listMyPresets() {
  return request('/presets/mine', { auth: true })
}

function presetPath(id) {
  if (!/^[0-9a-f]{32}$/.test(String(id))) throw new Error('Invalid preset id.')
  return `/presets/${id}`
}

// Downloads a preset and runs it through the same analysis as a local
// .ncvpreset pick, so the Mixer's import dialog can take it from there.
export async function downloadPreset(id) {
  if (!isCommunityAvailable()) return { ok: false, error: 'Community presets are not available in this build.' }
  let res
  try {
    res = await fetch(`${apiBase()}/v1${presetPath(id)}/bundle`)
  } catch {
    return { ok: false, error: "Couldn't reach the community server. Check your connection." }
  }
  if (!res.ok) {
    return { ok: false, error: res.status === 404 ? 'That preset is no longer available.' : `Download failed (${res.status}).` }
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) return { ok: false, error: 'That preset is too large.' }

  const chunks = []
  let total = 0
  for await (const chunk of res.body) {
    total += chunk.length
    if (total > MAX_DOWNLOAD_BYTES) return { ok: false, error: 'That preset is too large.' }
    chunks.push(chunk)
  }
  return prepareImport(Buffer.concat(chunks))
}

// Shares (presetId, no remoteId) or re-publishes (remoteId) a local preset.
export async function publishPreset({ presetId, remoteId = null, name, author, description, tags, rightsConfirmed }, onProgress) {
  if (!isCommunityAvailable()) return { ok: false, error: 'Community presets are not available in this build.' }
  const authorName = String(author ?? '').trim()
  if (authorName) store.set('authorName', authorName.slice(0, 40))

  const built = await buildCommunityBundle(presetId, { onProgress })
  if (!built.ok) return built

  const meta = {
    name,
    author: authorName,
    description,
    tags,
    rightsConfirmed: rightsConfirmed === true,
    soundCount: built.soundCount,
    appVersion: app.getVersion()
  }
  const form = new FormData()
  form.set('meta', JSON.stringify(meta))
  form.set('bundle', new Blob([built.buffer], { type: 'application/zip' }), 'preset.ncvpreset')

  onProgress?.({ message: `Uploading (${(built.buffer.length / 1024 / 1024).toFixed(1)} MB)…` })
  const result = await request(remoteId ? presetPath(remoteId) : '/presets', {
    method: remoteId ? 'PUT' : 'POST',
    body: form,
    auth: true
  })
  if (!result.ok) return result
  return {
    ok: true,
    preset: result.preset,
    uploadedAudioCount: built.uploadedAudioCount,
    freesoundCount: built.freesoundCount
  }
}

export function deletePreset(id) {
  return request(presetPath(id), { method: 'DELETE', auth: true })
}

export function reportPreset(id, reason) {
  return request(`${presetPath(id)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason: String(reason ?? '').slice(0, 300) }),
    headers: { 'content-type': 'application/json' }
  })
}
