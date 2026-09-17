// Noctívago community presets API - a Cloudflare Worker.
//
// Storage: D1 (`DB`) holds the preset list; R2 (`BUCKET`) holds each
// preset's .ncvpreset bundle (a zip - see the app's src/main/presetPortable.js).
// R2 has no egress fees, which is why audio lives there rather than in a
// database with per-GB download pricing.
//
// Identity: no accounts. Each app install generates a random 32-byte author
// key and sends it as `X-Author-Key`; only its SHA-256 is stored, and it is
// the only thing that can update or delete that install's uploads.
//
// Moderation: uploads go live immediately. REPORTS_TO_HIDE distinct
// reporters hide a preset until the admin (Bearer ADMIN_TOKEN) reviews it.
//
// Routes (all under /v1):
//   GET    /presets?q=&sort=new|popular&page=&pageSize=
//   GET    /presets/mine                       (X-Author-Key)
//   GET    /presets/:id
//   GET    /presets/:id/bundle
//   POST   /presets                            (X-Author-Key, multipart meta+bundle)
//   PUT    /presets/:id                        (X-Author-Key, multipart meta+bundle)
//   DELETE /presets/:id                        (X-Author-Key)
//   POST   /presets/:id/report                 ({ reason })
//   GET    /admin/presets?hidden=1             (Bearer)
//   POST   /admin/presets/:id/hide|unhide      (Bearer)
//   DELETE /admin/presets/:id                  (Bearer)

import {
  LIMITS,
  isValidAuthorKey,
  isValidPresetId,
  validateMeta,
  looksLikeZip,
  parseListQuery,
  likePattern,
  rowToPreset
} from './validate.js'

const PUBLIC_COLUMNS =
  'id, name, author, description, tags, sound_count, duration_seconds, size_bytes, downloads, app_version, created_at, updated_at'

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx)
    } catch (err) {
      console.error(err)
      return json({ ok: false, error: 'Server error.' }, 500)
    }
  }
}

async function route(request, env, ctx) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const method = request.method

  if (parts[0] !== 'v1') {
    if (parts.length === 0 && method === 'GET') return json({ ok: true, service: 'noctivago-community' })
    return notFound()
  }
  const [, resource, id, action, extra] = parts

  if (resource === 'presets') {
    if (!id) {
      if (method === 'GET') return listPresets(env, url.searchParams)
      if (method === 'POST') return savePreset(request, env, null)
      return methodNotAllowed()
    }
    if (id === 'mine' && !action && method === 'GET') return listMine(request, env)
    if (!isValidPresetId(id)) return notFound()
    if (!action) {
      if (method === 'GET') return getPreset(env, id)
      if (method === 'PUT') return savePreset(request, env, id)
      if (method === 'DELETE') return deleteOwnPreset(request, env, id)
      return methodNotAllowed()
    }
    if (action === 'bundle' && method === 'GET') return getBundle(env, ctx, id)
    if (action === 'report' && method === 'POST') return reportPreset(request, env, id)
    return notFound()
  }

  if (resource === 'admin') {
    if (!(await isAdmin(request, env))) return json({ ok: false, error: 'Unauthorized.' }, 401)
    if (id !== 'presets') return notFound()
    if (!action && method === 'GET') return adminList(env, url.searchParams)
    if (!isValidPresetId(action ?? '')) return notFound()
    if (!extra && method === 'DELETE') return removePreset(env, action)
    if ((extra === 'hide' || extra === 'unhide') && method === 'POST') {
      await env.DB.prepare('UPDATE presets SET hidden = ? WHERE id = ?').bind(extra === 'hide' ? 1 : 0, action).run()
      return json({ ok: true })
    }
    return notFound()
  }

  return notFound()
}

// --- read -------------------------------------------------------------------

async function listPresets(env, searchParams) {
  const { q, sort, page, pageSize } = parseListQuery(searchParams)
  const offset = (page - 1) * pageSize
  let where = 'hidden = 0'
  const binds = []
  if (q) {
    where += " AND (name LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\' OR author LIKE ?1 ESCAPE '\\')"
    binds.push(likePattern(q))
  }
  // One extra row tells us whether another page exists.
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS} FROM presets WHERE ${where} ORDER BY ${sort} LIMIT ${pageSize + 1} OFFSET ${offset}`
  )
    .bind(...binds)
    .all()
  return json({
    ok: true,
    results: results.slice(0, pageSize).map(rowToPreset),
    hasMore: results.length > pageSize
  })
}

async function listMine(request, env) {
  const keyHash = await authorKeyHash(request)
  if (!keyHash) return json({ ok: false, error: 'Missing author key.' }, 401)
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS}, hidden FROM presets WHERE author_key_hash = ? ORDER BY created_at DESC LIMIT 200`
  )
    .bind(keyHash)
    .all()
  return json({ ok: true, results: results.map((r) => ({ ...rowToPreset(r), hidden: Boolean(r.hidden) })) })
}

async function getPreset(env, id) {
  const row = await env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM presets WHERE id = ? AND hidden = 0`).bind(id).first()
  if (!row) return notFound()
  return json({ ok: true, preset: rowToPreset(row) })
}

async function getBundle(env, ctx, id) {
  const row = await env.DB.prepare('SELECT id FROM presets WHERE id = ? AND hidden = 0').bind(id).first()
  if (!row) return notFound()
  const object = await env.BUCKET.get(bundleKey(id))
  if (!object) return notFound()
  ctx.waitUntil(env.DB.prepare('UPDATE presets SET downloads = downloads + 1 WHERE id = ?').bind(id).run())
  return new Response(object.body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(object.size),
      'cache-control': 'no-store'
    }
  })
}

// --- write ------------------------------------------------------------------

// Creates (id null) or replaces (id set, same author key) a preset.
async function savePreset(request, env, id) {
  const keyHash = await authorKeyHash(request)
  if (!keyHash) return json({ ok: false, error: 'Missing author key.' }, 401)

  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > LIMITS.maxBundleBytes + 64 * 1024) {
    return json({ ok: false, error: tooLargeMessage() }, 413)
  }

  if (id) {
    const existing = await env.DB.prepare('SELECT author_key_hash FROM presets WHERE id = ?').bind(id).first()
    if (!existing) return notFound()
    if (existing.author_key_hash !== keyHash) return json({ ok: false, error: 'You can only update your own presets.' }, 403)
  }

  const client = await clientHash(request, env)
  if (!(await takeRateLimit(env, client, 'upload', LIMITS.uploadsPerDay))) {
    return json({ ok: false, error: 'Daily upload limit reached - try again tomorrow.' }, 429)
  }

  let form
  try {
    form = await request.formData()
  } catch {
    return json({ ok: false, error: 'Malformed upload.' }, 400)
  }
  let metaInput
  try {
    metaInput = JSON.parse(String(form.get('meta') ?? ''))
  } catch {
    return json({ ok: false, error: 'Malformed preset details.' }, 400)
  }
  const checked = validateMeta(metaInput)
  if (!checked.ok) return json(checked, 400)
  const { meta } = checked

  const file = form.get('bundle')
  if (!file || typeof file.arrayBuffer !== 'function') return json({ ok: false, error: 'Missing preset file.' }, 400)
  if (file.size > LIMITS.maxBundleBytes) return json({ ok: false, error: tooLargeMessage() }, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!looksLikeZip(bytes)) return json({ ok: false, error: "That isn't a Noctívago preset file." }, 400)

  const presetId = id ?? crypto.randomUUID().replace(/-/g, '')
  const now = new Date().toISOString()
  await env.BUCKET.put(bundleKey(presetId), bytes, { httpMetadata: { contentType: 'application/zip' } })

  if (id) {
    await env.DB.prepare(
      `UPDATE presets SET name = ?, author = ?, description = ?, tags = ?, sound_count = ?, duration_seconds = ?,
        size_bytes = ?, app_version = ?, updated_at = ? WHERE id = ?`
    )
      .bind(meta.name, meta.author, meta.description, JSON.stringify(meta.tags), meta.soundCount, meta.durationSeconds, bytes.length, meta.appVersion, now, presetId)
      .run()
  } else {
    await env.DB.prepare(
      `INSERT INTO presets (id, name, author, description, tags, sound_count, duration_seconds, size_bytes, app_version,
        author_key_hash, uploader_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(presetId, meta.name, meta.author, meta.description, JSON.stringify(meta.tags), meta.soundCount, meta.durationSeconds, bytes.length, meta.appVersion, keyHash, client, now, now)
      .run()
  }

  const row = await env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM presets WHERE id = ?`).bind(presetId).first()
  return json({ ok: true, preset: rowToPreset(row) }, id ? 200 : 201)
}

async function deleteOwnPreset(request, env, id) {
  const keyHash = await authorKeyHash(request)
  if (!keyHash) return json({ ok: false, error: 'Missing author key.' }, 401)
  const existing = await env.DB.prepare('SELECT author_key_hash FROM presets WHERE id = ?').bind(id).first()
  if (!existing) return notFound()
  if (existing.author_key_hash !== keyHash) return json({ ok: false, error: 'You can only delete your own presets.' }, 403)
  return removePreset(env, id)
}

async function removePreset(env, id) {
  await env.BUCKET.delete(bundleKey(id))
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE preset_id = ?').bind(id),
    env.DB.prepare('DELETE FROM presets WHERE id = ?').bind(id)
  ])
  return json({ ok: true })
}

async function reportPreset(request, env, id) {
  const row = await env.DB.prepare('SELECT id FROM presets WHERE id = ?').bind(id).first()
  if (!row) return notFound()
  let body = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, LIMITS.reasonMax) : ''
  const client = await clientHash(request, env)
  if (!(await takeRateLimit(env, client, 'report', LIMITS.reportsPerDay))) {
    return json({ ok: false, error: 'Too many reports today.' }, 429)
  }
  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (preset_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, client, reason, new Date().toISOString())
    .run()
  // A repeat report from the same client is accepted but not counted twice.
  if (inserted.meta.changes > 0) {
    await env.DB.prepare(
      'UPDATE presets SET report_count = report_count + 1, hidden = CASE WHEN report_count + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?'
    )
      .bind(LIMITS.reportsToHide, id)
      .run()
  }
  return json({ ok: true })
}

// --- admin ------------------------------------------------------------------

async function adminList(env, searchParams) {
  const hiddenOnly = searchParams.get('hidden') === '1'
  const { results } = await env.DB.prepare(
    `SELECT ${PUBLIC_COLUMNS}, hidden, report_count FROM presets ${hiddenOnly ? 'WHERE hidden = 1' : ''}
      ORDER BY report_count DESC, created_at DESC LIMIT 200`
  ).all()
  const presets = []
  for (const r of results) {
    const { results: reports } = await env.DB.prepare('SELECT reason, created_at FROM reports WHERE preset_id = ? ORDER BY created_at DESC LIMIT 20')
      .bind(r.id)
      .all()
    presets.push({ ...rowToPreset(r), hidden: Boolean(r.hidden), reportCount: r.report_count, reports })
  }
  return json({ ok: true, presets })
}

async function isAdmin(request, env) {
  const token = env.ADMIN_TOKEN
  const header = request.headers.get('authorization') || ''
  if (!token || !header.startsWith('Bearer ')) return false
  // Compare hashes so the comparison time doesn't depend on the token.
  const [a, b] = await Promise.all([sha256Hex(header.slice(7)), sha256Hex(token)])
  return a === b
}

// --- helpers ----------------------------------------------------------------

function bundleKey(id) {
  return `bundles/${id}.ncvpreset`
}

async function authorKeyHash(request) {
  const key = request.headers.get('x-author-key')
  return isValidAuthorKey(key) ? sha256Hex(key) : null
}

async function clientHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  return sha256Hex(`${env.IP_SALT || 'dev-salt'}:${ip}`)
}

async function takeRateLimit(env, client, action, limit) {
  const day = new Date().toISOString().slice(0, 10)
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (client, action, day, count) VALUES (?, ?, ?, 1)
      ON CONFLICT (client, action, day) DO UPDATE SET count = count + 1 RETURNING count`
  )
    .bind(client, action, day)
    .first()
  return row.count <= limit
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function tooLargeMessage() {
  return `Preset files can be at most ${Math.round(LIMITS.maxBundleBytes / 1024 / 1024)} MB.`
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function notFound() {
  return json({ ok: false, error: 'Not found.' }, 404)
}

function methodNotAllowed() {
  return json({ ok: false, error: 'Method not allowed.' }, 405)
}
