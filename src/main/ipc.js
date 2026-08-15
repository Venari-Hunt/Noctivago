import { ipcMain } from 'electron'
import * as library from './library.js'
import * as presets from './presets.js'
import { renderLoopClip } from './ffmpeg/loopClip.js'
import { extractWaveformPeaks } from './ffmpeg/waveformPeaks.js'
import { getPlugins } from './plugins/registry.js'
import { invokePlugin } from './plugins/invoke.js'

export function registerIpcHandlers() {
  ipcMain.handle('library:list', () => library.listSounds())
  ipcMain.handle('library:pickFile', () => library.pickFile())
  ipcMain.handle('library:pickFolder', () => library.pickFolder())
  ipcMain.handle('library:addSound', (_event, payload) => library.addSound(payload))
  ipcMain.handle('library:addFolderSounds', (_event, folderPath, options) => library.addFolderSounds(folderPath, options))
  ipcMain.handle('library:updateMeta', (_event, id, meta) => library.updateMeta(id, meta))
  ipcMain.handle('library:updateLoopPoints', (_event, id, points) => library.updateLoopPoints(id, points))
  ipcMain.handle('library:updateFilters', (_event, id, filters) => library.updateFilters(id, filters))
  ipcMain.handle('library:rename', (_event, id, name) => library.rename(id, name))
  ipcMain.handle('library:relink', (_event, id) => library.relink(id))
  ipcMain.handle('library:remove', (_event, id) => library.remove(id))

  ipcMain.handle('presets:list', () => presets.listPresets())
  ipcMain.handle('presets:save', (_event, payload) => presets.savePreset(payload))
  ipcMain.handle('presets:delete', (_event, id) => presets.deletePreset(id))

  ipcMain.handle('audio:renderLoopClip', async (_event, id, { loopStart, loopEnd, filters }) => {
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath) return { ok: false, error: 'Source file not found' }
    const result = await renderLoopClip({ id, inputPath, loopStart, loopEnd, filters })
    if (result.ok) library.setLoopClipReady(id, { loopStart, loopEnd, filters })
    else library.setLoopClipStale(id)
    return result
  })

  ipcMain.handle('audio:getWaveformPeaks', async (_event, id, targetWidth) => {
    const entry = library.listSounds().find((s) => s.id === id)
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath || entry?.durationSeconds == null) return null
    try {
      return await extractWaveformPeaks({ inputPath, durationSeconds: entry.durationSeconds, targetWidth })
    } catch (err) {
      console.error('Waveform extraction failed', id, err)
      return null
    }
  })

  ipcMain.handle('plugins:list', () => getPlugins().map((p) => ({ id: p.id, manifest: p.manifest })))

  ipcMain.handle('plugin:invoke', (_event, pluginId, method, args) => invokePlugin(pluginId, method, args))
}
