import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getLoopClipPath, deleteLoopClip } from './ffmpeg/loopClip.js'

const store = new Store({
  name: 'library',
  defaults: { sounds: [], lastAddFolder: null }
})

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'opus']

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
    filters: { highpassHz: 0, lowpassHz: 20000, gainDb: 0 },
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
