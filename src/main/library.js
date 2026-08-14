import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getLoopClipPath, deleteLoopClip } from './ffmpeg/loopClip.js'

const store = new Store({
  name: 'library',
  defaults: { sounds: [] }
})

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a']

function soundsDir() {
  const dir = path.join(app.getPath('userData'), 'sounds')
  fs.mkdirSync(dir, { recursive: true })
  return dir
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
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  const stats = fs.statSync(filePath)
  return {
    path: filePath,
    name: path.parse(filePath).name,
    sizeBytes: stats.size
  }
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
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
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

export function setLoopClipReady(id, { loopStart, loopEnd }) {
  return updateEntry(id, { loopClipReady: true, loopClipStart: loopStart, loopClipEnd: loopEnd })
}

export function setLoopClipStale(id) {
  return updateEntry(id, { loopClipReady: false, loopClipStart: null, loopClipEnd: null })
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
    loopClipEnd: null
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
    entry.loopClipReady && entry.loopClipStart === entry.loopStart && entry.loopClipEnd === entry.loopEnd
  if (!eligible) return null
  const clipPath = getLoopClipPath(id)
  return fs.existsSync(clipPath) ? clipPath : null
}
