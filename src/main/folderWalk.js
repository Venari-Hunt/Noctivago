import fs from 'node:fs/promises'
import path from 'node:path'

// Shared recursive directory walker (v0.1.201) - split out of library.js's
// scanWatchedFolder so both it and a future hardened addFolderSounds can
// share one implementation instead of duplicating the walk. Its own
// dependency-free module (only node:fs/promises + node:path) so it stays
// unit-testable outside Electron, same reasoning as watchFolderTags.js.
//
// Replaces the plain `fs.readdirSync(root, { recursive: true })` the
// original v0.1.198 implementation used, which had two real weaknesses on a
// large/unusual real-world folder:
//
// 1. No cycle protection - a Windows directory junction, or a OneDrive
//    "placeholder" reparse point, can point back at one of its own
//    ancestors, and `{ recursive: true }` has no way to notice and would
//    walk that loop forever. This walker resolves each directory's real
//    (symlink/junction-resolved) path via `fs.realpath` and skips a
//    directory it's already visited under its real path.
// 2. Fully synchronous - `readdirSync` walks and returns the *entire* tree
//    in one blocking call, freezing the main process's event loop (and
//    every IPC call the renderer is waiting on) for however long a very
//    large or deep watched folder takes. This walker uses the async
//    fs/promises API and yields to the event loop between directories via
//    `setImmediate`, so a big scan is chunked rather than one long freeze.
//
// Calls `onFile(dirent, parentDir)` for every regular file found,
// depth-first - the same (Dirent, containing-directory-path) shape callers
// already destructured from the old flattened `{ recursive: true }` result
// (which exposed the containing directory via `dirent.parentPath`).
export async function walkFilesRecursive(rootPath, onFile) {
  const visitedRealPaths = new Set()

  async function walk(dirPath) {
    let realDirPath
    try {
      realDirPath = await fs.realpath(dirPath)
    } catch {
      return // gone since the caller last checked - skip quietly
    }
    if (visitedRealPaths.has(realDirPath)) return // cycle - this real directory was already walked
    visitedRealPaths.add(realDirPath)

    let dirents
    try {
      dirents = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return // permission error, or removed mid-walk
    }

    for (const dirent of dirents) {
      const fullPath = path.join(dirPath, dirent.name)
      if (dirent.isDirectory()) {
        await walk(fullPath)
        await new Promise((resolve) => setImmediate(resolve))
      } else if (dirent.isFile()) {
        onFile(dirent, dirPath)
      }
    }
  }

  await walk(rootPath)
}
