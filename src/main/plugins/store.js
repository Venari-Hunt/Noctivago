import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getPlugins, userPluginsDir, invalidatePlugins, ORIGIN_FILE } from './registry.js'
import { parseCatalog, normalizeStats, checkReleaseManifest, releaseAssetNames, compareVersions, releaseFileUrl, readmeUrl } from '../../shared/pluginStore.js'
import { isOfficialRepo, canInstallFromStore } from '../../shared/pluginEnablement.js'
import { getSettings } from '../settings.js'

// The in-app plugin store, Obsidian-style: a reviewed list file names each
// community plugin's GitHub repo, and installing downloads that repo's latest
// GitHub Release assets (manifest.json + the files it names) into
// <userData>/plugins/<id>/, the folder registry.js already scans. Downloads
// use github.com/<repo>/releases/latest/download/<file>, which redirects to
// the asset without touching the rate-limited GitHub API.
const LIST_URL = 'https://raw.githubusercontent.com/Venari-Hunt/noctivago-plugins/main/community-plugins.json'
// Download counts per plugin, rebuilt daily by an Action in the same repo.
const STATS_URL = 'https://raw.githubusercontent.com/Venari-Hunt/noctivago-plugins/main/community-plugin-stats.json'
// A README bigger than this is cut off rather than rendered.
const README_MAX_BYTES = 200 * 1024

// Dev-only overrides, so the store can be exercised against a local server:
// NOCTIVAGO_PLUGIN_LIST_URL replaces the list, NOCTIVAGO_PLUGIN_STATS_URL the
// stats, NOCTIVAGO_PLUGIN_RELEASE_BASE replaces https://github.com (files and
// README.md are then read from <base>/<repo>/<file>).
function devOverride(name) {
  return !app.isPackaged && process.env[name]
}

function listUrl() {
  return devOverride('NOCTIVAGO_PLUGIN_LIST_URL') || LIST_URL
}

function statsUrl() {
  return devOverride('NOCTIVAGO_PLUGIN_STATS_URL') || STATS_URL
}

function fileUrl(repo, fileName) {
  const base = devOverride('NOCTIVAGO_PLUGIN_RELEASE_BASE')
  return base ? `${base}/${repo}/${encodeURIComponent(fileName)}` : releaseFileUrl(repo, fileName)
}

function repoReadmeUrl(repo) {
  const base = devOverride('NOCTIVAGO_PLUGIN_RELEASE_BASE')
  return base ? `${base}/${repo}/README.md` : readmeUrl(repo)
}

async function request(url) {
  try {
    return await fetch(url, { cache: 'no-store' })
  } catch (err) {
    throw new Error(`Couldn't reach ${new URL(url).host} (${err.message})`)
  }
}

async function download(url) {
  const res = await request(url)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function downloadJson(url) {
  const buf = await download(url)
  try {
    return JSON.parse(buf.toString('utf-8'))
  } catch {
    throw new Error(`Not valid JSON: ${url}`)
  }
}

// The last list fetched, so install() looks the repo up itself rather than
// trusting a repo string sent from the renderer.
let catalogById = new Map()

async function latestManifest(entry) {
  return checkReleaseManifest(await downloadJson(fileUrl(entry.repo, 'manifest.json')), entry.id)
}

function installedById() {
  const map = new Map()
  for (const p of getPlugins()) map.set(p.id, { version: p.manifest.version, source: p.source, dir: p.dir })
  return map
}

// Stats are optional: without them the list still loads, just with no counts.
async function loadStats() {
  try {
    return normalizeStats(await downloadJson(statsUrl()))
  } catch {
    return {}
  }
}

// Returns { plugins: [{ id, name, author, description, repo, official,
// downloads, updated, installed }] }. installed is null or
// { version, source: 'user' | 'bundled' }; updated is a ms timestamp or null.
export async function listCatalog() {
  const [json, stats] = await Promise.all([downloadJson(listUrl()), loadStats()])
  const entries = parseCatalog(json)
  catalogById = new Map(entries.map((e) => [e.id, e]))
  const installed = installedById()
  return {
    plugins: entries.map((e) => {
      const local = installed.get(e.id)
      return {
        ...e,
        official: isOfficialRepo(e.repo),
        downloads: stats[e.id]?.downloads ?? 0,
        updated: stats[e.id]?.updated ?? null,
        installed: local ? { version: local.version, source: local.source } : null
      }
    })
  }
}

// The latest release's manifest, for the detail view: version, mainProcess
// (shown as a warning before install), and whether it's newer than the copy
// installed now.
export async function checkLatest(id) {
  const entry = catalogById.get(id)
  if (!entry) throw new Error(`"${id}" isn't in the plugin list`)
  const manifest = await latestManifest(entry)
  const local = installedById().get(id)
  return {
    version: manifest.version,
    mainProcess: Boolean(manifest.mainProcess),
    minAppVersion: manifest.minAppVersion ?? null,
    updateAvailable: Boolean(local && compareVersions(manifest.version, local.version) > 0)
  }
}

// The plugin repo's README.md as plain text ('' when it has none). The
// Settings window renders it as formatted text, never as HTML.
export async function readme(id) {
  const entry = catalogById.get(id)
  if (!entry) throw new Error(`"${id}" isn't in the plugin list`)
  const res = await request(repoReadmeUrl(entry.repo))
  if (res.status === 404) return { text: '', truncated: false }
  if (!res.ok) throw new Error(`Couldn't load the README (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  return { text: buf.subarray(0, README_MAX_BYTES).toString('utf-8'), truncated: buf.length > README_MAX_BYTES }
}

// Installs or updates. Files are downloaded into a staging folder first and
// only swapped into place once every one arrived, so a failed download never
// leaves a half-installed plugin behind.
export async function install(id) {
  const entry = catalogById.get(id)
  if (!entry) throw new Error(`"${id}" isn't in the plugin list`)
  const local = installedById().get(id)
  if (local?.source === 'bundled') throw new Error(`"${id}" is built into Noctívago and can't be replaced`)
  if (!canInstallFromStore(entry.repo, { restrictedMode: getSettings().restrictedMode })) {
    throw new Error('Turn off Restricted mode in Settings > Community plugins to install third-party plugins')
  }

  const manifest = await latestManifest(entry)
  const files = releaseAssetNames(manifest)

  const root = userPluginsDir()
  const staging = path.join(root, `.staging-${id}`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })
  try {
    for (const name of files) {
      fs.writeFileSync(path.join(staging, name), await download(fileUrl(entry.repo, name)))
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2))
    fs.writeFileSync(path.join(staging, ORIGIN_FILE), JSON.stringify({ repo: entry.repo }))

    const target = local?.dir ?? path.join(root, id)
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(staging, target)
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw err
  } finally {
    invalidatePlugins()
  }
  return { version: manifest.version }
}

// Deletes a user-installed plugin's folder. Bundled plugins can't be removed.
export function uninstall(id) {
  const local = installedById().get(id)
  if (!local) throw new Error(`"${id}" isn't installed`)
  if (local.source !== 'user') throw new Error(`"${id}" is built into Noctívago and can't be removed`)
  fs.rmSync(local.dir, { recursive: true, force: true })
  invalidatePlugins()
  return { ok: true }
}

// Plugins are loaded once at startup (and a mainProcess module stays cached
// in invoke.js), so installs take effect on a full restart.
export function restartApp() {
  app.relaunch()
  app.quit()
}
