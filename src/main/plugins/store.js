import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getPlugins, userPluginsDir, invalidatePlugins } from './registry.js'
import { parseCatalog, checkReleaseManifest, releaseAssetNames, compareVersions, releaseFileUrl } from '../../shared/pluginStore.js'

// The in-app plugin store, Obsidian-style: a reviewed list file names each
// community plugin's GitHub repo, and installing downloads that repo's latest
// GitHub Release assets (manifest.json + the files it names) into
// <userData>/plugins/<id>/, the folder registry.js already scans. Downloads
// use github.com/<repo>/releases/latest/download/<file>, which redirects to
// the asset without touching the rate-limited GitHub API.
const LIST_URL = 'https://raw.githubusercontent.com/Venari-Hunt/noctivago-plugins/main/community-plugins.json'

// Dev-only overrides, so the store can be exercised against a local server:
// NOCTIVAGO_PLUGIN_LIST_URL replaces the list, NOCTIVAGO_PLUGIN_RELEASE_BASE
// replaces https://github.com (files are then read from <base>/<repo>/<file>).
function listUrl() {
  return (!app.isPackaged && process.env.NOCTIVAGO_PLUGIN_LIST_URL) || LIST_URL
}

function fileUrl(repo, fileName) {
  const base = !app.isPackaged && process.env.NOCTIVAGO_PLUGIN_RELEASE_BASE
  return base ? `${base}/${repo}/${encodeURIComponent(fileName)}` : releaseFileUrl(repo, fileName)
}

async function download(url) {
  let res
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (err) {
    throw new Error(`Couldn't reach ${new URL(url).host} (${err.message})`)
  }
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

// Returns { plugins: [{ id, name, author, description, repo, installed }] }.
// installed is null or { version, source: 'user' | 'bundled' }.
export async function listCatalog() {
  const entries = parseCatalog(await downloadJson(listUrl()))
  catalogById = new Map(entries.map((e) => [e.id, e]))
  const installed = installedById()
  return {
    plugins: entries.map((e) => {
      const local = installed.get(e.id)
      return { ...e, installed: local ? { version: local.version, source: local.source } : null }
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

// Installs or updates. Files are downloaded into a staging folder first and
// only swapped into place once every one arrived, so a failed download never
// leaves a half-installed plugin behind.
export async function install(id) {
  const entry = catalogById.get(id)
  if (!entry) throw new Error(`"${id}" isn't in the plugin list`)
  const local = installedById().get(id)
  if (local?.source === 'bundled') throw new Error(`"${id}" is built into Noctívago and can't be replaced`)

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
