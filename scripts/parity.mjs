// Feature parity check: everything the old app (and old plugins) had must
// exist in the new code, or be listed in docs/parity-manifest.json with a
// reason. Run it before every step that touches UI:
//   node scripts/parity.mjs            report, exit 1 if anything is unexplained
//   node scripts/parity.mjs --json     same, machine-readable
//   node scripts/parity.mjs --verbose  also list what was explained
//
// "Old" = the commit the redesign branched from (app: be0c70d, plugins: the
// merge-base of the branch with main). "New" = the working tree. Four
// inventories are compared:
//   ipc       main-process channels (ipcMain.handle / .on)
//   api       methods the preload script exposes on window.noctivago
//   strings   user-visible text in the UI source (labels, titles, tooltips,
//             JSX text, placeholders, aria-labels)
//   settings  keys in the settings defaults and the data schema
// A string counts as present if it appears ANYWHERE in the new tree, so
// moving a control to another screen is fine; renaming or dropping one is
// reported until the manifest says so.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsRoot = path.resolve(repo, '../noctivago-plugin-repos')
const APP_OLD_REF = 'be0c70d'
const manifestPath = path.join(repo, 'docs/parity-manifest.json')
const asJson = process.argv.includes('--json')
const verbose = process.argv.includes('--verbose')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim()

// Export a git ref to a scratch folder (no worktree, nothing touches the repo).
function exportRef(cwd, ref, name) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `parity-${name}-`))
  const tar = path.join(dest, '_x.tar')
  execFileSync('git', ['archive', '--format=tar', '-o', tar, ref], { cwd })
  execFileSync('tar', ['-xf', '_x.tar'], { cwd: dest })
  fs.rmSync(tar)
  return dest
}

const SRC_EXT = /\.(jsx?|mjs|tsx?|html|css)$/
const IGNORE_DIR = new Set(['node_modules', 'out', 'dist', 'test', 'tests', 'e2e', 'types', '.git', 'export-tmp'])
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  if (fs.statSync(dir).isFile()) return SRC_EXT.test(dir) ? [...out, dir] : out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIR.has(e.name) || e.name.endsWith('.tmp.mjs')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (SRC_EXT.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(p)
  }
  return out
}
const read = (f) => fs.readFileSync(f, 'utf8')
// Source without comments: a comment is not a feature.
const readCode = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

// ---- extractors -----------------------------------------------------------
const ipcOf = (root) => {
  const set = new Set()
  for (const f of walk(path.join(root, 'src/main'))) {
    for (const m of read(f).matchAll(/ipcMain\.(?:handle|on|once)\(\s*['"`]([^'"`]+)['"`]/g)) set.add(m[1])
  }
  return set
}
const apiOf = (root) => {
  const set = new Set()
  const f = path.join(root, 'src/preload/index.js')
  if (!fs.existsSync(f)) return set
  // top-level and nested keys of the exposed api object: `name:` / `name(` / `name,` at line start
  for (const m of read(f).matchAll(/^\s{2,6}([A-Za-z_]\w*)\s*(?::|\()/gm)) set.add(m[1])
  return set
}
const settingsOf = (root) => {
  const set = new Set()
  for (const rel of ['src/shared/dataSchema.js', 'src/shared/constants.js', 'src/renderer/settings/domain']) {
    const p = path.join(root, rel)
    const files = fs.existsSync(p) && fs.statSync(p).isDirectory() ? walk(p) : fs.existsSync(p) ? [p] : []
    for (const f of files) {
      for (const m of read(f).matchAll(/^\s{2,8}([A-Za-z_]\w*)\s*:/gm)) set.add(m[1])
    }
  }
  return set
}

// Visible text: JSX text nodes, label-ish props, and string literals that read
// like UI copy (start with a letter, have a space or end in a capitalized word).
const PROPS = 'title|label|placeholder|aria-label|alt|tooltip|text|hint|description|heading|name|caption'
const looksLikeCopy = (s) => {
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length < 3 || s.length > 90) return null
  if (!/[A-Za-z]{3}/.test(s)) return null
  if (/^[a-z][\w.-]*$/.test(s) && !/[A-Z]/.test(s)) return null // identifiers, css classes
  if (/^[A-Za-z]+[:/.\\_][\w:/.\\-]*$/.test(s)) return null // ids, paths, channels
  if (/[{}<>=;]|=>|\$\{/.test(s)) return null // code
  if (/^(https?:|#|\.|\/|--)/.test(s)) return null
  if (/^[A-Z][a-z]+[A-Z]\w*$/.test(s)) return null // camelCase identifier
  if (/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)+$/.test(s) && /-/.test(s)) return null // css class lists
  if (/[()→]|\breturn\b|\bdefault:/.test(s) || /^[a-z]\s/.test(s)) return null // code or comments
  return s
}
const stringsOf = (root, dirs) => {
  const map = new Map() // text -> first file
  const add = (t, f) => {
    const c = looksLikeCopy(t)
    if (c && !map.has(c)) map.set(c, path.relative(root, f).replace(/\\/g, '/'))
  }
  for (const d of dirs) {
    for (const f of walk(path.join(root, d))) {
      if (f.endsWith('.css')) continue
      const src = readCode(f)
      for (const m of src.matchAll(new RegExp(`\\b(?:${PROPS})\\s*[:=]\\s*(?:\\{\\s*)?(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 'g'))) add(m[2], f)
      for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) add(m[1], f) // JSX / HTML text
      for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\n\\]){3,90})\1/g)) {
        if (/\s/.test(m[2]) || /^[A-Z]/.test(m[2])) add(m[2], f)
      }
    }
  }
  return map
}
// Everything in the new tree as one searchable blob (for "appears anywhere").
const blobOf = (root, dirs) => dirs.flatMap((d) => walk(path.join(root, d))).filter((f) => !f.endsWith('.css')).map(read).join('\n')

// ---- units to compare -----------------------------------------------------
const units = []
{
  const oldRoot = exportRef(repo, APP_OLD_REF, 'app')
  units.push({ name: 'app', oldRoot, newRoot: repo, dirs: ['src/renderer', 'src/shared'], full: true })
}
if (fs.existsSync(pluginsRoot)) {
  for (const d of fs.readdirSync(pluginsRoot).filter((n) => n.startsWith('noctivago-') && fs.existsSync(path.join(pluginsRoot, n, 'manifest.json')))) {
    const cwd = path.join(pluginsRoot, d)
    let base
    try { base = git(cwd, 'merge-base', 'HEAD', 'main') } catch { continue }
    if (base === git(cwd, 'rev-parse', 'HEAD')) continue // branch has no redesign work
    units.push({ name: d.replace('noctivago-', 'plugin:'), oldRoot: exportRef(cwd, base, d), newRoot: cwd, dirs: ['src', 'main.js'], full: false })
  }
}

const manifest = fs.existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : { explained: [] }
// manifest.explained: [{ kind, unit?, item, status: "removed"|"renamed"|"moved", why, now? }]
const explainedKey = (e) => `${e.kind}|${e.unit ?? '*'}|${e.item}`
const explained = new Map(manifest.explained.map((e) => [explainedKey(e), e]))
const isExplained = (kind, unit, item) => explained.get(`${kind}|${unit}|${item}`) ?? explained.get(`${kind}|*|${item}`)

const report = []
for (const u of units) {
  const missing = { ipc: [], api: [], strings: [], settings: [] }
  const ok = { ipc: 0, api: 0, strings: 0, settings: 0 }
  const checks = []
  if (u.full) {
    const nIpc = ipcOf(u.newRoot)
    for (const c of ipcOf(u.oldRoot)) checks.push(['ipc', c, nIpc.has(c) ? null : ''])
    const nApi = apiOf(u.newRoot)
    for (const c of apiOf(u.oldRoot)) checks.push(['api', c, nApi.has(c) ? null : ''])
    const nSet = settingsOf(u.newRoot)
    for (const c of settingsOf(u.oldRoot)) checks.push(['settings', c, nSet.has(c) ? null : ''])
  }
  const newBlob = blobOf(u.newRoot, u.dirs)
  const newText = u.full ? blobOf(u.newRoot, ['src/main', 'src/preload']) + newBlob : newBlob
  const norm = (t) => t.toLowerCase().replace(/[….!?:\s]+$/g, '').replace(/\s+/g, ' ')
  const newTextN = norm(newText)
  const newStrings = new Set([...stringsOf(u.newRoot, u.dirs).keys()].map(norm))
  for (const [t, f] of stringsOf(u.oldRoot, u.dirs)) {
    const present = newStrings.has(norm(t)) || newTextN.includes(norm(t))
    checks.push(['strings', t, present ? null : f])
  }
  for (const [kind, item, where] of checks) {
    if (where === null) { ok[kind]++; continue }
    const why = isExplained(kind, u.name, item)
    if (why) { (missing[kind].explainedList ??= []).push({ item, ...why }); ok[kind]++ } else missing[kind].push({ item, where })
  }
  report.push({ unit: u.name, ok, missing })
}

for (const u of units) fs.rmSync(u.oldRoot, { recursive: true, force: true })

const unexplained = report.reduce((n, r) => n + Object.values(r.missing).reduce((a, l) => a + l.length, 0), 0)
if (asJson) {
  console.log(JSON.stringify({ unexplained, report: report.map((r) => ({ ...r, missing: Object.fromEntries(Object.entries(r.missing).map(([k, v]) => [k, [...v]])) })) }, null, 2))
} else {
  for (const r of report) {
    const tot = Object.values(r.ok).reduce((a, b) => a + b, 0)
    const miss = Object.values(r.missing).reduce((a, l) => a + l.length, 0)
    console.log(`\n== ${r.unit}: ${tot} kept or explained, ${miss} unexplained`)
    for (const [kind, list] of Object.entries(r.missing)) {
      for (const m of list) console.log(`  MISSING ${kind}: ${m.item}${m.where ? `   (old: ${m.where})` : ''}`)
      if (verbose) for (const e of list.explainedList ?? []) console.log(`  ok ${kind}: ${e.item} -> ${e.status}: ${e.why}`)
    }
  }
  console.log(`\n${unexplained === 0 ? 'PARITY OK' : `PARITY GAPS: ${unexplained} unexplained`} (explain real removals in docs/parity-manifest.json)`)
}
process.exit(unexplained === 0 ? 0 : 1)
