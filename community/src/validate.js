// Pure request validation for the community preset API - no Worker
// bindings, so test/validate.test.js runs it under plain node.

export const LIMITS = {
  // Under the free plan's 100 MB request-body cap with room for the form
  // around it; the Worker's 128 MB of memory holds one upload, so the file
  // goes to R2 as is (no second copy).
  maxBundleBytes: 80 * 1024 * 1024,
  // Stored bundles stay under this total, inside R2's 10 GB free tier (R2 has
  // no built-in spending cap). When an upload would pass it, the oldest
  // presets are deleted to make room (pickEvictions).
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  nameMax: 80,
  descriptionMax: 600,
  authorMax: 40,
  tagMax: 24,
  tagCount: 8,
  soundCountMax: 250,
  pageSizeMax: 48,
  uploadsPerDay: 10,
  reportsPerDay: 30,
  reportsToHide: 3,
  reasonMax: 300
}

export const SORTS = {
  new: 'created_at DESC',
  popular: 'downloads DESC, created_at DESC'
}

const AUTHOR_KEY_RE = /^[0-9a-f]{64}$/
const ID_RE = /^[0-9a-f]{32}$/

export function isValidAuthorKey(key) {
  return typeof key === 'string' && AUTHOR_KEY_RE.test(key)
}

export function isValidPresetId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  // Strip control characters (keep plain newlines for descriptions).
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max)
}

// Validates the JSON metadata sent alongside an upload. Returns
// { ok, meta } or { ok: false, error }.
export function validateMeta(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Missing preset details.' }
  const name = cleanText(input.name, LIMITS.nameMax).replace(/\n/g, ' ')
  if (!name) return { ok: false, error: 'The preset needs a name.' }
  const author = cleanText(input.author, LIMITS.authorMax).replace(/\n/g, ' ')
  if (!author) return { ok: false, error: 'Add an author name.' }
  const description = cleanText(input.description, LIMITS.descriptionMax)

  const tags = []
  for (const raw of Array.isArray(input.tags) ? input.tags : []) {
    const tag = cleanText(raw, LIMITS.tagMax).replace(/\n/g, ' ').toLowerCase()
    if (tag && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= LIMITS.tagCount) break
  }

  const soundCount = Number(input.soundCount)
  if (!Number.isInteger(soundCount) || soundCount < 1 || soundCount > LIMITS.soundCountMax) {
    return { ok: false, error: 'The preset has no sounds.' }
  }
  const durationSeconds = Number(input.durationSeconds)
  const appVersion = cleanText(input.appVersion, 20)

  if (input.rightsConfirmed !== true) {
    return { ok: false, error: 'Confirm you have the right to share this audio.' }
  }

  return {
    ok: true,
    meta: {
      name,
      author,
      description,
      tags,
      soundCount,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds) : null,
      appVersion: appVersion || null
    }
  }
}

// A preset bundle is a ZIP (the app's src/main/zip.js). A cheap signature
// check keeps obvious junk out of storage; the app validates the contents
// again on download.
export function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function parseListQuery(searchParams) {
  const q = cleanText(searchParams.get('q') ?? '', 80).replace(/\n/g, ' ')
  const sortKey = SORTS[searchParams.get('sort')] ? searchParams.get('sort') : 'new'
  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1))
  const rawSize = Math.floor(Number(searchParams.get('pageSize')) || 24)
  const pageSize = Math.min(Math.max(rawSize, 1), LIMITS.pageSizeMax)
  return { q, sort: SORTS[sortKey], sortKey, page, pageSize }
}

// Escapes LIKE wildcards so a search for "100%" matches literally.
export function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export function rowToPreset(row) {
  let tags = []
  try {
    tags = JSON.parse(row.tags || '[]')
  } catch {
    tags = []
  }
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    description: row.description,
    tags,
    soundCount: row.sound_count,
    durationSeconds: row.duration_seconds,
    sizeBytes: row.size_bytes,
    downloads: row.downloads,
    appVersion: row.app_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Which presets to delete so `needBytes` more fit. `rows` come oldest
// first ({ id, size_bytes, hidden }); hidden (reported) ones go before any
// visible one. Returns the ids, or null when even deleting all is not enough.
export function pickEvictions(rows, needBytes) {
  if (needBytes <= 0) return []
  const ordered = [...rows.filter((r) => r.hidden), ...rows.filter((r) => !r.hidden)]
  const ids = []
  let freed = 0
  for (const r of ordered) {
    if (freed >= needBytes) break
    ids.push(r.id)
    freed += Number(r.size_bytes) || 0
  }
  return freed >= needBytes ? ids : null
}

// A download's Range header as R2's range option: { offset, length } or
// { suffix } (the zip's index sits at the end, so the phone asks for the
// last bytes first). null = whole file; 'invalid' = refuse with 416. One
// range only.
export function parseRange(header) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  if (m[1] === '') {
    const suffix = Number(m[2])
    return suffix > 0 ? { suffix } : 'invalid'
  }
  const offset = Number(m[1])
  if (m[2] === '') return { offset }
  const end = Number(m[2])
  return end >= offset ? { offset, length: end - offset + 1 } : 'invalid'
}

// A request counts as a download when it reads the whole file (the PC) or
// starts at the end (the phone's first read of the zip index).
export function countsAsDownload(range) {
  return range === null || Boolean(range?.suffix)
}
