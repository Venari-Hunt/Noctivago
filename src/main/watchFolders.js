import fs from 'node:fs'
import path from 'node:path'
import * as library from './library.js'
import { tagsForWatchedFile } from './watchFolderTags.js'

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
function scheduleStabilityCheck(folderEntry, filePath, tags) {
  clearTimeout(pendingTimers.get(filePath))
  pendingTimers.set(
    filePath,
    setTimeout(() => checkStable(folderEntry, filePath, tags), STABLE_CHECK_MS)
  )
}

function checkStable(folderEntry, filePath, tags) {
  pendingTimers.delete(filePath)
  fs.stat(filePath, (err, statsBefore) => {
    if (err) return // deleted/renamed away before this fired
    setTimeout(() => {
      fs.stat(filePath, (err2, statsAfter) => {
        if (err2) return
        if (statsAfter.size !== statsBefore.size) {
          scheduleStabilityCheck(folderEntry, filePath, tags) // still growing, wait again
          return
        }
        const sound = library.importIfNew(filePath, folderEntry.keepCopy, tags)
        if (sound) notifyLibraryChanged()
      })
    }, STABLE_CHECK_MS)
  })
}

// Recursive (v0.1.198, see library.js's scanWatchedFolder/tagsForWatchedFile
// for the matching initial-scan half and the tagging rule itself) - `{
// recursive: true }` is well-supported on Windows (the only platform this
// app targets), where the callback's second argument is the changed file's
// path *relative to the watched root* rather than a bare filename whenever
// it's inside a subfolder, which is exactly what's needed both to find the
// file (joined back onto the root) and to derive its tags (every path
// segment before the filename).
function watchFolder(folderEntry) {
  if (watchers.has(folderEntry.id)) return
  try {
    const watcher = fs.watch(folderEntry.path, { recursive: true }, (_eventType, relativePath) => {
      if (!relativePath) return
      const fileName = path.basename(relativePath)
      if (!isAudioFile(fileName)) return
      const filePath = path.join(folderEntry.path, relativePath)
      const tags = tagsForWatchedFile(folderEntry.path, path.dirname(filePath))
      scheduleStabilityCheck(folderEntry, filePath, tags)
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
export async function startWatching() {
  let anyAdded = false
  for (const entry of library.listWatchedFolders()) {
    if ((await library.scanWatchedFolder(entry)).length > 0) anyAdded = true
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
