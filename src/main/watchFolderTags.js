import path from 'node:path'

// A file's tags are every subfolder name between a watched root and the
// file itself, outermost first (e.g. `<root>/Rain/Heavy/thunder.wav` under
// a root watching `<root>` gets tags `['Rain', 'Heavy']`) - the watched-
// folder equivalent of the manual "Add folder as tag" dialog, but derived
// automatically per subfolder level instead of one tag the user types for
// the whole flat folder. A file directly in the watched root has no
// subfolder to derive a tag from, so it gets none - matching how the manual
// flow already requires an explicit tag since there's nothing to derive
// there either.
//
// Its own tiny module (not folded into library.js, which constructs a real
// electron-store `Store` at import time and so can't be imported by a plain
// `node:test` run outside Electron) purely so this pure path logic stays
// unit-testable - library.js and watchFolders.js both just import it.
export function tagsForWatchedFile(rootPath, containingDir) {
  const rel = path.relative(rootPath, containingDir)
  if (!rel || rel.startsWith('..')) return []
  return rel.split(path.sep).filter(Boolean)
}
