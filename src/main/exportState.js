// Tracks whether a preset export is currently baking, so autoUpdate.js can
// hold off closing/restarting the app to install an update mid-export -
// direct owner instruction ("takes precedence over anything"). A plain
// module-level counter (not a class/store) since this is the whole surface:
// ipc.js's export:run handler brackets its exportMix() call with
// begin/end, autoUpdate.js only ever reads isExportInProgress() or waits via
// whenExportIdle(). Counted rather than boolean in case a future entry point
// ever runs a second export concurrently (composite bakes are a separate,
// much shorter operation and deliberately not counted here).
let count = 0
const idleListeners = new Set()

export function beginExport() {
  count++
}

export function endExport() {
  count = Math.max(0, count - 1)
  if (count === 0) {
    const listeners = [...idleListeners]
    idleListeners.clear()
    listeners.forEach((fn) => fn())
  }
}

export function isExportInProgress() {
  return count > 0
}

// Calls fn immediately if no export is running, otherwise defers it until
// the export (or the last of several) finishes. One-shot per call.
export function whenExportIdle(fn) {
  if (count === 0) {
    fn()
    return
  }
  idleListeners.add(fn)
}
