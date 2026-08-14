import { ipcMain } from 'electron'
import * as library from './library.js'
import * as presets from './presets.js'

export function registerIpcHandlers() {
  ipcMain.handle('library:list', () => library.listSounds())
  ipcMain.handle('library:pickFile', () => library.pickFile())
  ipcMain.handle('library:addSound', (_event, payload) => library.addSound(payload))
  ipcMain.handle('library:updateMeta', (_event, id, meta) => library.updateMeta(id, meta))
  ipcMain.handle('library:updateLoopPoints', (_event, id, points) => library.updateLoopPoints(id, points))
  ipcMain.handle('library:relink', (_event, id) => library.relink(id))
  ipcMain.handle('library:remove', (_event, id) => library.remove(id))

  ipcMain.handle('presets:list', () => presets.listPresets())
  ipcMain.handle('presets:save', (_event, payload) => presets.savePreset(payload))
  ipcMain.handle('presets:delete', (_event, id) => presets.deletePreset(id))
}
