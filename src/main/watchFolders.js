import fs from 'node:fs'
import path from 'node:path'
import * as library from './library.js'

const watchers = new Map() // folder id -> fs.FSWatcher
const pendingTimers = new Map() // absolute file path -> timeout id
const STABLE_CHECK_MS = 800

let mainWindow = null

export function initWatchFolders(win) {
  mainWindow = win
}

function notifyLibraryChanged() {
  mainWindow?.webContents.send('library:changed')
}

function isAudioFile(fileName) {
  return library.AUDIO_EXTENSIONS.includes(path.extname(fileName).slice(1).toLowerCase())
}

// fs.watch fires as soon as a file appears in the folder, which for a large
// audio file being copied in is often mid-write - waits for the file's size
// to stop changing across two checks, spaced apart, before importing it,
// rather than risking an import of a truncated/partial file.
function scheduleStabilityCheck(folderEntry, filePath) {
  clearTimeout(pendingTimers.get(filePath))
  pendingTimers.set(
    filePath,
    setTimeout(() => checkStable(folderEntry, filePath), STABLE_CHECK_MS)
  )
}

function checkStable(folderEntry, filePath) {
  pendingTimers.delete(filePath)
  fs.stat(filePath, (err, statsBefore) => {
    if (err) return // deleted/renamed away before this fired
    setTimeout(() => {
      fs.stat(filePath, (err2, statsAfter) => {
        if (err2) return
        if (statsAfter.size !== statsBefore.size) {
          scheduleStabilityCheck(folderEntry, filePath) // still growing, wait again
          return
        }
        const sound = library.importIfNew(filePath, folderEntry.keepCopy)
        if (sound) notifyLibraryChanged()
      })
    }, STABLE_CHECK_MS)
  })
}

function watchFolder(folderEntry) {
  if (watchers.has(folderEntry.id)) return
  try {
    const watcher = fs.watch(folderEntry.path, (_eventType, fileName) => {
      if (!fileName || !isAudioFile(fileName)) return
      scheduleStabilityCheck(folderEntry, path.join(folderEntry.path, fileName))
    })
    watcher.on('error', () => stopWatchingFolder(folderEntry.id))
    watchers.set(folderEntry.id, watcher)
  } catch {
    // Folder missing/inaccessible right now - library.listWatchedFolders()
    // already reflects this via its 'missing' status; nothing more to do
    // until the user removes it or the app restarts and rescans.
  }
}

function stopWatchingFolder(id) {
  const watcher = watchers.get(id)
  if (watcher) {
    watcher.close()
    watchers.delete(id)
  }
}

// Called once at app startup: rescans every watched folder (covers files
// dropped in while the app was closed, since fs.watch only reports changes
// while actively running) before starting live watching on each.
export function startWatching() {
  let anyAdded = false
  for (const entry of library.listWatchedFolders()) {
    if (library.scanWatchedFolder(entry).length > 0) anyAdded = true
    if (entry.status === 'ok') watchFolder(entry)
  }
  if (anyAdded) notifyLibraryChanged()
}

export function watchNewFolder(entry) {
  watchFolder(entry)
}

export function unwatchFolder(id) {
  stopWatchingFolder(id)
}

export function stopWatching() {
  for (const id of [...watchers.keys()]) stopWatchingFolder(id)
}
