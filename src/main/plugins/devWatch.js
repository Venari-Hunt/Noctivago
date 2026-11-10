import { app } from 'electron'
import fs from 'node:fs'
import { userPluginsDir, invalidatePlugins } from './registry.js'

// Dev builds only: a plugin folder copied in by scripts/dev-plugin.mjs (or
// edited by hand) reloads live, like a store install does. Waits for the
// copying to go quiet, drops the registry cache, and tells the window to
// re-sync. Packaged builds never watch.
export function initPluginDevWatch(win) {
  if (app.isPackaged) return
  let timer = null
  fs.watch(userPluginsDir(), { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      invalidatePlugins()
      if (!win.isDestroyed()) win.webContents.send('plugins:changed', {})
    }, 400)
  })
}
