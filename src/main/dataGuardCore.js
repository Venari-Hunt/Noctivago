// Keeps the user's data safe when the app moves between update channels
// (Stable and Nightly), and above all when it goes back from a newer Nightly
// to an older Stable.
//
// How other apps do it, and what this copies:
// - Firefox writes the last version that opened a profile into
//   compatibility.ini and refuses to open it with an older version
//   (downgrade protection). Here: data-version.json, with the data schema.
// - Chrome keeps a snapshot of the user data after each major update and,
//   on a rollback, restores the newest snapshot not newer than the version
//   being run (chrome/browser/downgrade/snapshot_manager.cc). Here: one
//   snapshot of the JSON stores per upgrade, in userData/snapshots.
// - Joplin's "profile version" shows what happens without either: an older
//   app meets a newer database and stops with a fatal error.
//
// The rule that keeps most downgrades a non-event lives in CLAUDE.md
// ("Data that survives a downgrade"): store changes are additive (new
// fields only, old ones still written, unknown ones kept), so an older app
// reads newer data fine. DATA_SCHEMA goes up only for a change an older app
// cannot read, and only then does a downgrade restore a snapshot.
//
// Everything here is plain sync fs on paths passed in, so it runs before
// any electron-store opens its file and the tests can drive it in a temp
// folder.
import fs from 'node:fs'
import path from 'node:path'

// The files a snapshot covers: every electron-store JSON in userData. Audio
// in sounds/ is never rewritten in place (only added or removed) and the
// clips/ cache is rebuilt on demand, so neither needs a copy.
export const GUARDED_FILES = ['library.json', 'presets.json', 'settings.json', 'community.json']
export const STAMP_FILE = 'data-version.json'
export const SNAPSHOT_DIR = 'snapshots'
export const KEEP_SNAPSHOTS = 3

// semver order, prerelease included: 2.0.1-nightly.20261111.4 < 2.0.1.
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = String(v).replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number(n) || 0), pre: pre ? pre.split('.') : null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (!x.pre && !y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn && Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q))
    if (pn !== qn) return pn ? -1 : 1
    if (p !== q) return p < q ? -1 : 1
  }
  return 0
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
const writeJson = (file, data) => {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}
const safeName = (s) => String(s).replace(/[^0-9A-Za-z.+-]/g, '_')

export function readStamp(userData) {
  return readJson(path.join(userData, STAMP_FILE))
}

export function listSnapshots(userData) {
  const dir = path.join(userData, SNAPSHOT_DIR)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, dir: path.join(dir, name), meta: readJson(path.join(dir, name, 'snapshot.json')) }))
    .filter((s) => s.meta && s.meta.version && Number.isFinite(s.meta.schema))
    .sort((a, b) => compareVersions(b.meta.version, a.meta.version) || String(b.meta.takenAt).localeCompare(String(a.meta.takenAt)))
}

function copyGuarded(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const f of GUARDED_FILES) {
    const src = path.join(from, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, f))
  }
}

// Copies the stores as they are now. `meta` says which app version and
// schema wrote them, so a later downgrade can pick one it can read.
export function takeSnapshot(userData, { version, schema, reason, now = new Date() }) {
  const name = safeName(`${version}`) + (reason === 'set-aside' ? '-set-aside' : '')
  const dir = path.join(userData, SNAPSHOT_DIR, name)
  fs.rmSync(dir, { recursive: true, force: true })
  copyGuarded(userData, dir)
  writeJson(path.join(dir, 'snapshot.json'), { version, schema, reason, takenAt: now.toISOString() })
  return dir
}

// Keeps the newest KEEP_SNAPSHOTS, plus the newest snapshot of every schema,
// so a run of Nightly updates can never push out the last copy an older
// Stable is able to read. Set-aside copies (data a downgrade moved out of
// the way) are kept too: they are the only copy of that data.
export function pruneSnapshots(userData, keep = KEEP_SNAPSHOTS) {
  const all = listSnapshots(userData)
  const keepNames = new Set(all.slice(0, keep).map((s) => s.name))
  const seenSchema = new Set()
  for (const s of all) {
    if (!seenSchema.has(s.meta.schema)) {
      seenSchema.add(s.meta.schema)
      keepNames.add(s.name)
    }
    if (s.meta.reason === 'set-aside') keepNames.add(s.name)
  }
  for (const s of all) if (!keepNames.has(s.name)) fs.rmSync(s.dir, { recursive: true, force: true })
}

// What to do at startup, decided from the stamp alone (pure).
//   stamp: { schema, version } or null; app: { version, schema }
export function planDataGuard(stamp, app, snapshots = []) {
  const hasData = stamp !== null
  if (!hasData) return { action: 'stamp' }
  const stampSchema = Number.isFinite(stamp.schema) ? stamp.schema : 1
  if (stampSchema > app.schema) {
    // Written by a newer app in a way this one cannot read.
    const usable = snapshots.find((s) => s.meta.schema <= app.schema && s.meta.reason !== 'set-aside')
    return usable ? { action: 'restore', snapshot: usable, from: stamp } : { action: 'block', from: stamp }
  }
  if (stamp.version && compareVersions(app.version, stamp.version) > 0) return { action: 'snapshot', from: stamp }
  // Same version, or an older one that still reads this schema (additive
  // changes only), like Firefox's --allow-downgrade but safe by rule.
  return { action: 'stamp' }
}

// Runs the plan. Returns what happened, for the log and the one-time notice.
export function runDataGuard(userData, app, { now = new Date() } = {}) {
  fs.mkdirSync(userData, { recursive: true })
  const stamp = readStamp(userData)
  const firstRun = stamp === null && !GUARDED_FILES.some((f) => fs.existsSync(path.join(userData, f)))
  // Data from before the guard existed has no stamp: it is schema 1, written
  // by some older version. Snapshot it once so it has a safe copy too.
  const effective = stamp ?? (firstRun ? null : { schema: 1, version: '0.0.0' })
  const plan = planDataGuard(effective, app, listSnapshots(userData))
  const stampNow = () => writeJson(path.join(userData, STAMP_FILE), { schema: app.schema, version: app.version, writtenAt: now.toISOString() })

  if (plan.action === 'snapshot') {
    takeSnapshot(userData, { version: effective.version, schema: effective.schema ?? 1, reason: 'upgrade', now })
    pruneSnapshots(userData)
  }
  if (plan.action === 'restore' || plan.action === 'block') {
    // Chrome-style: the newer data is moved aside (never deleted, so going
    // back to Nightly can still use it), then the snapshot is copied in.
    // With no readable snapshot ('block') the app starts empty instead of
    // crashing on data it cannot read; the set-aside copy keeps everything.
    const keep = preservedSettings(userData)
    const asideDir = takeSnapshot(userData, { version: effective.version, schema: effective.schema, reason: 'set-aside', now })
    for (const f of GUARDED_FILES) fs.rmSync(path.join(userData, f), { force: true })
    if (plan.action === 'restore') copyGuarded(plan.snapshot.dir, userData)
    restoreSettings(userData, keep)
    stampNow()
    return { ...plan, stamped: true, asideDir }
  }
  stampNow()
  return { ...plan, stamped: true }
}

// Choices that belong to "now", not to the data being restored: an older
// snapshot was usually taken while the user was still switching to Nightly,
// so its updateChannel would send Stable straight back to Nightly.
export const PRESERVED_SETTINGS = ['updateChannel']

function preservedSettings(userData) {
  const settings = readJson(path.join(userData, 'settings.json')) ?? {}
  return Object.fromEntries(PRESERVED_SETTINGS.filter((k) => k in settings).map((k) => [k, settings[k]]))
}

function restoreSettings(userData, keep) {
  if (!Object.keys(keep).length) return
  const file = path.join(userData, 'settings.json')
  writeJson(file, { ...(readJson(file) ?? {}), ...keep })
}
