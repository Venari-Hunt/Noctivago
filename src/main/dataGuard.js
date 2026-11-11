import { app } from 'electron'
import { runDataGuard } from './dataGuardCore.js'
import { DATA_SCHEMA } from '../shared/dataSchema.js'

// Must be imported right after devMode.js in main/index.js (devMode picks
// the userData folder) and before anything that opens an electron-store
// (library.js, presets.js, settings.js, community/client.js), so a snapshot
// or a restore happens before any store has read its file. See
// dataGuardCore.js for what it does and why.
// The single-instance lock is taken here, not in index.js, so a second
// launch (which quits at once) never snapshots or restores files the running
// app has open.
export const isFirstInstance = app.requestSingleInstanceLock()

let result = null
if (isFirstInstance) {
  try {
    result = runDataGuard(app.getPath('userData'), { version: app.getVersion(), schema: DATA_SCHEMA })
  } catch (err) {
    // Never stop the app from starting over a backup problem; the log says why.
    result = { action: 'error', error: String((err && err.stack) || err) }
  }
}

// For main/index.js: logs it once electron-log is set up, and shows a notice
// when data was restored or set aside.
export function getDataGuardResult() {
  return result
}
