// Pure helpers for the in-app plugin store (src/main/plugins/store.js).
// Electron-free so they can be unit-tested directly.
//
// The store follows Obsidian's model: one reviewed list file
// (community-plugins.json in Venari-Hunt/noctivago-plugins) names each
// plugin's GitHub repo, and the plugin's files are downloaded from that
// repo's latest GitHub Release, one release asset per file. When the latest
// release needs a newer app, the repo's versions.json names an older one.

import { validateManifest } from './pluginManifest.js'

// "owner/repo" as GitHub allows it.
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
// A release asset name: a plain file name, no folders, not hidden.
const ASSET_NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// Validates one community-plugins.json entry. Returns a clean copy (only the
// known fields) or null, so one bad entry drops out instead of breaking the list.
export function normalizeListEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const { id, name, author, description, repo } = entry
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo) || repo.includes('..')) return null
  return {
    id,
    name: name.trim(),
    author: typeof author === 'string' ? author.trim() : '',
    description: typeof description === 'string' ? description.trim() : '',
    repo
  }
}

// Parses the whole list file. Duplicate ids keep the first entry.
export function parseCatalog(json) {
  if (!Array.isArray(json)) throw new Error('community-plugins.json must be a JSON array')
  const seen = new Set()
  const out = []
  for (const raw of json) {
    const entry = normalizeListEntry(raw)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

// The files a store install downloads, besides manifest.json itself. Store
// plugins must keep every file at the top level of the release (a release
// asset has no folders), so a manifest pointing into a subfolder is refused.
export function releaseAssetNames(manifest) {
  const names = [manifest.main, manifest.styles, manifest.mainProcess].filter(Boolean)
  for (const name of names) {
    if (!ASSET_NAME_PATTERN.test(name) || name === 'manifest.json') {
      throw new Error(`"${name}" must be a plain file name at the top of the release`)
    }
  }
  return [...new Set(names)]
}

// Checks a manifest downloaded for a store install: the normal manifest rules,
// plus it must be the plugin the list entry says it is.
export function checkReleaseManifest(manifest, expectedId) {
  const { ok, errors } = validateManifest(manifest)
  if (!ok) throw new Error(`Invalid manifest.json: ${errors.join('; ')}`)
  if (manifest.id !== expectedId) {
    throw new Error(`manifest.json says id "${manifest.id}", but the plugin list says "${expectedId}"`)
  }
  releaseAssetNames(manifest)
  return manifest
}

// Compares two MAJOR.MINOR.PATCH[-pre] versions: negative if a < b, 0 if
// equal, positive if a > b. A prerelease sorts before its release.
export function compareVersions(a, b) {
  const [coreA, preA] = String(a).split('-', 2)
  const [coreB, preB] = String(b).split('-', 2)
  const partsA = coreA.split('.').map(Number)
  const partsB = coreB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0)
    if (diff !== 0) return diff
  }
  if (preA && !preB) return -1
  if (!preA && preB) return 1
  if (preA && preB) return preA < preB ? -1 : preA > preB ? 1 : 0
  return 0
}

// A file from the plugin's latest release, or from the release tagged `tag`
// (Obsidian's convention: the tag is the manifest version, no "v").
export function releaseFileUrl(repo, fileName, tag = null) {
  const release = tag ? `download/${encodeURIComponent(tag)}` : 'latest/download'
  return `https://github.com/${repo}/releases/${release}/${encodeURIComponent(fileName)}`
}

// versions.json on the plugin repo's default branch: { "<plugin version>":
// "<minAppVersion>" }, Obsidian's shape. Only read when the latest release
// needs a newer app than the one running.
export function versionsUrl(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/versions.json`
}

// Whether a manifest's minAppVersion lets it run on appVersion.
export function supportsApp(manifest, appVersion) {
  return !manifest.minAppVersion || compareVersions(appVersion, manifest.minAppVersion) >= 0
}

// The newest plugin version in versions.json that runs on appVersion, or
// null. Malformed entries are skipped.
export function pickCompatibleVersion(versions, appVersion) {
  if (!versions || typeof versions !== 'object' || Array.isArray(versions)) return null
  let best = null
  for (const [version, minApp] of Object.entries(versions)) {
    if (!VERSION_PATTERN.test(version) || typeof minApp !== 'string' || !VERSION_PATTERN.test(minApp)) continue
    if (compareVersions(appVersion, minApp) < 0) continue
    if (!best || compareVersions(version, best) > 0) best = version
  }
  return best
}

// Validates community-plugin-stats.json, Obsidian's shape:
// { "<id>": { downloads, updated, "<version>": count, … } }. Returns
// { "<id>": { downloads, updated } }, keeping only well-formed numbers, so a
// bad stats file just means no counts are shown.
export function normalizeStats(json) {
  const out = {}
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out
  for (const [id, raw] of Object.entries(json)) {
    if (!ID_PATTERN.test(id) || !raw || typeof raw !== 'object') continue
    const downloads = Number.isFinite(raw.downloads) && raw.downloads >= 0 ? Math.floor(raw.downloads) : 0
    const updated = Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : null
    out[id] = { downloads, updated }
  }
  return out
}

// README.md from the plugin repo's default branch, for the Browse detail pane.
export function readmeUrl(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/README.md`
}
