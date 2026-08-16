import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getLoopClipPath, deleteLoopClip } from './ffmpeg/loopClip.js'

const store = new Store({
  name: 'library',
  defaults: { sounds: [], lastAddFolder: null, watchedFolders: [] }
})

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'opus']

// This app only ships for Windows (see CLAUDE.md), and NTFS path comparison
// is case-insensitive - lowercasing after path.resolve() is enough to treat
// "C:\Sounds\Rain.mp3" and "c:\sounds\rain.mp3" as the same file for dedup.
function normalizePath(p) {
  return path.resolve(p).toLowerCase()
}

function soundsDir() {
  const dir = path.join(app.getPath('userData'), 'sounds')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// undefined (not null) when unset/stale, since that's what dialog.showOpenDialog's
// defaultPath expects to mean "use the OS default" rather than erroring on a
// missing path.
function getLastAddFolder() {
  const folder = store.get('lastAddFolder')
  return folder && fs.existsSync(folder) ? folder : undefined
}

function setLastAddFolder(folderPath) {
  store.set('lastAddFolder', folderPath)
}

function resolvePlaybackPath(entry) {
  if (entry.storageMode === 'copied') {
    return path.join(soundsDir(), entry.storedFileName)
  }
  return entry.originalPath
}

function checkStatus(entry) {
  return fs.existsSync(resolvePlaybackPath(entry)) ? 'ok' : 'missing'
}

export function listSounds() {
  const sounds = store.get('sounds')
  let changed = false
  const refreshed = sounds.map((entry) => {
    const status = checkStatus(entry)
    if (status !== entry.status) changed = true
    return { ...entry, status }
  })
  if (changed) store.set('sounds', refreshed)
  return refreshed
}

export async function pickFile() {
  const result = await dialog.showOpenDialog({
    title: 'Add sound',
    defaultPath: getLastAddFolder(),
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  setLastAddFolder(path.dirname(filePath))
  const stats = fs.statSync(filePath)
  return {
    path: filePath,
    name: path.parse(filePath).name,
    sizeBytes: stats.size
  }
}

export async function pickFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Add folder as preset',
    defaultPath: getLastAddFolder(),
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folderPath = result.filePaths[0]
  setLastAddFolder(folderPath)
  return folderPath
}

export async function pickWatchFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Watch folder',
    defaultPath: getLastAddFolder(),
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folderPath = result.filePaths[0]
  setLastAddFolder(folderPath)
  return folderPath
}

export function listWatchedFolders() {
  const folders = store.get('watchedFolders')
  let changed = false
  const refreshed = folders.map((f) => {
    const status = fs.existsSync(f.path) ? 'ok' : 'missing'
    if (status !== f.status) changed = true
    return { ...f, status }
  })
  if (changed) store.set('watchedFolders', refreshed)
  return refreshed
}

// A file already registered under any storage mode (manually added, or
// picked up by a previous scan of this or another watched folder) is never
// re-imported - compares by resolved/lowercased originalPath, so a "copied"
// entry (whose originalPath still points at the source, even though
// playback reads from the stored copy) still dedups correctly.
function hasSoundForPath(filePath) {
  const normalized = normalizePath(filePath)
  return store.get('sounds').some((s) => normalizePath(s.originalPath) === normalized)
}

export function importIfNew(filePath, keepCopy) {
  if (!AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) return null
  if (hasSoundForPath(filePath)) return null
  return addSound({ path: filePath, name: path.parse(filePath).name, keepCopy })
}

// Non-recursive, matching addFolderSounds' existing convention. Used both
// for the initial scan when a folder starts being watched and, via
// watchFolders.js's startWatching(), as a scan-on-startup so files dropped
// in while the app was closed are still picked up (fs.watch only reports
// changes while it's actively running).
export function scanWatchedFolder(entry) {
  if (!fs.existsSync(entry.path)) return []
  const files = fs
    .readdirSync(entry.path, { withFileTypes: true })
    .map((e) => (e.isFile() ? path.join(entry.path, e.name) : null))
    .filter(Boolean)
  const added = []
  for (const filePath of files) {
    const sound = importIfNew(filePath, entry.keepCopy)
    if (sound) added.push(sound)
  }
  return added
}

export function addWatchedFolder(folderPath, { keepCopy }) {
  const folders = store.get('watchedFolders')
  const normalized = normalizePath(folderPath)
  const existing = folders.find((f) => normalizePath(f.path) === normalized)
  if (existing) return { entry: existing, added: [] }

  const entry = { id: crypto.randomUUID(), path: folderPath, keepCopy: Boolean(keepCopy), status: 'ok' }
  folders.push(entry)
  store.set('watchedFolders', folders)
  const added = scanWatchedFolder(entry)
  return { entry, added }
}

export function removeWatchedFolder(id) {
  const folders = store.get('watchedFolders')
  store.set('watchedFolders', folders.filter((f) => f.id !== id))
}

// Adds every audio file directly inside folderPath (non-recursive) to the
// library via the same addSound() every single-file add goes through.
// Returns the added entries so the caller can build a preset from them -
// this function only touches the library, never presets.js, so it stays
// reusable for a plain "add several files at once" case too if that's ever
// wanted without the preset step.
export function addFolderSounds(folderPath, { keepCopy }) {
  const files = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()))
    .map((entry) => path.join(folderPath, entry.name))

  return files.map((filePath) => addSound({ path: filePath, name: path.parse(filePath).name, keepCopy }))
}

export function addSound({ path: sourcePath, name, keepCopy }) {
  const id = crypto.randomUUID()
  const stats = fs.statSync(sourcePath)

  let storageMode = 'reference'
  let storedFileName = null
  if (keepCopy) {
    storedFileName = `${id}${path.extname(sourcePath)}`
    fs.copyFileSync(sourcePath, path.join(soundsDir(), storedFileName))
    storageMode = 'copied'
  }

  const entry = {
    id,
    name,
    originalPath: sourcePath,
    storageMode,
    storedFileName,
    fileSizeBytes: stats.size,
    durationSeconds: null,
    loopStart: 0,
    loopEnd: null,
    filters: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    status: 'ok'
  }

  const sounds = store.get('sounds')
  sounds.push(entry)
  store.set('sounds', sounds)
  return entry
}

function updateEntry(id, patch) {
  const sounds = store.get('sounds')
  const idx = sounds.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sounds[idx] = { ...sounds[idx], ...patch }
  store.set('sounds', sounds)
  return sounds[idx]
}

export function updateMeta(id, { durationSeconds }) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  const patch = { durationSeconds }
  if (entry && entry.loopEnd === null) patch.loopEnd = durationSeconds
  return updateEntry(id, patch)
}

export function updateLoopPoints(id, { loopStart, loopEnd }) {
  return updateEntry(id, { loopStart, loopEnd })
}

export function updateFilters(id, filters) {
  return updateEntry(id, { filters })
}

export function rename(id, name) {
  const trimmed = name.trim()
  if (!trimmed) return null
  return updateEntry(id, { name: trimmed })
}

export function setLoopClipReady(id, { loopStart, loopEnd, filters }) {
  return updateEntry(id, {
    loopClipReady: true,
    loopClipStart: loopStart,
    loopClipEnd: loopEnd,
    loopClipFilters: filters
  })
}

export function setLoopClipStale(id) {
  return updateEntry(id, { loopClipReady: false, loopClipStart: null, loopClipEnd: null, loopClipFilters: null })
}

export async function relink(id) {
  const result = await dialog.showOpenDialog({
    title: 'Locate sound file',
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  deleteLoopClip(id)
  return updateEntry(id, {
    originalPath: result.filePaths[0],
    status: 'ok',
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null
  })
}

export function remove(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (entry && entry.storageMode === 'copied' && entry.storedFileName) {
    const filePath = path.join(soundsDir(), entry.storedFileName)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  deleteLoopClip(id)
  store.set('sounds', sounds.filter((s) => s.id !== id))
}

export function getPlaybackPathForId(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (!entry) return null
  const filePath = resolvePlaybackPath(entry)
  return fs.existsSync(filePath) ? filePath : null
}

export function getLoopClipPathForId(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (!entry) return null
  const eligible =
    entry.loopClipReady &&
    entry.loopClipStart === entry.loopStart &&
    entry.loopClipEnd === entry.loopEnd &&
    JSON.stringify(entry.loopClipFilters) === JSON.stringify(entry.filters)
  if (!eligible) return null
  const clipPath = getLoopClipPath(id)
  return fs.existsSync(clipPath) ? clipPath : null
}
