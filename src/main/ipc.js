import { app, ipcMain } from 'electron'
import * as library from './library.js'
import * as presets from './presets.js'
import { renderLoopClip } from './ffmpeg/loopClip.js'
import { extractWaveformPeaks } from './ffmpeg/waveformPeaks.js'
import { getPlugins } from './plugins/registry.js'
import { invokePlugin } from './plugins/invoke.js'
import { getSettings, setMinimizeToTrayEnabled, setAutoInstallUpdatesEnabled, setWasPlayingOnClose, setEagerlyBakeOnImportEnabled } from './settings.js'
import { setAutoUpdateEnabled, checkForUpdatesNow } from './autoUpdate.js'
import { setTrayEnabled } from './tray.js'
import { watchNewFolder, unwatchFolder } from './watchFolders.js'

export function registerIpcHandlers() {
  ipcMain.handle('app:isPackaged', () => app.isPackaged)

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:setAutoUpdateEnabled', (_event, enabled) => setAutoUpdateEnabled(enabled))
  ipcMain.handle('settings:setAutoInstallUpdatesEnabled', (_event, enabled) => setAutoInstallUpdatesEnabled(enabled))
  ipcMain.handle('autoUpdate:checkNow', () => checkForUpdatesNow())
  ipcMain.handle('settings:setMinimizeToTrayEnabled', (_event, enabled) => {
    const settings = setMinimizeToTrayEnabled(enabled)
    setTrayEnabled(enabled)
    return settings
  })
  ipcMain.handle('settings:setWasPlayingOnClose', (_event, wasPlaying) => setWasPlayingOnClose(wasPlaying))
  ipcMain.handle('settings:setEagerlyBakeOnImportEnabled', (_event, enabled) => setEagerlyBakeOnImportEnabled(enabled))

  ipcMain.handle('library:list', () => library.listSounds())
  ipcMain.handle('library:pickFile', () => library.pickFile())
  ipcMain.handle('library:pickFolder', () => library.pickFolder())
  ipcMain.handle('library:addSound', (_event, payload) => library.addSound(payload))
  ipcMain.handle('library:addFolderSounds', (_event, folderPath, options) => library.addFolderSounds(folderPath, options))
  ipcMain.handle('library:updateMeta', (_event, id, meta) => library.updateMeta(id, meta))
  ipcMain.handle('library:updateLoopPoints', (_event, id, points) => library.updateLoopPoints(id, points))
  ipcMain.handle('library:updateFilters', (_event, id, filters) => library.updateFilters(id, filters))
  ipcMain.handle('library:updateVolume', (_event, id, volume) => library.updateVolume(id, volume))
  ipcMain.handle('library:updateIncluded', (_event, id, included) => library.updateIncluded(id, included))
  ipcMain.handle('library:updateCrossfade', (_event, id, crossfadeSeconds) => library.updateCrossfade(id, crossfadeSeconds))
  ipcMain.handle('library:updateTags', (_event, id, tags) => library.updateTags(id, tags))
  ipcMain.handle('library:updateSpeedPitch', (_event, id, speedPitch) => library.updateSpeedPitch(id, speedPitch))
  ipcMain.handle('library:updatePlayMode', (_event, id, playMode) => library.updatePlayMode(id, playMode))
  ipcMain.handle('library:updateScatterConfig', (_event, id, scatter) => library.updateScatterConfig(id, scatter))
  ipcMain.handle('library:reorderSounds', (_event, orderedIds) => library.reorderSounds(orderedIds))
  ipcMain.handle('library:rename', (_event, id, name) => library.rename(id, name))
  ipcMain.handle('library:relink', (_event, id) => library.relink(id))
  ipcMain.handle('library:remove', (_event, id) => library.remove(id))
  ipcMain.handle('library:listWatchedFolders', () => library.listWatchedFolders())
  ipcMain.handle('library:pickWatchFolder', () => library.pickWatchFolder())
  ipcMain.handle('library:addWatchedFolder', (_event, folderPath, options) => {
    const { entry, added } = library.addWatchedFolder(folderPath, options)
    watchNewFolder(entry)
    return { entry, addedCount: added.length }
  })
  ipcMain.handle('library:removeWatchedFolder', (_event, id) => {
    unwatchFolder(id)
    library.removeWatchedFolder(id)
  })

  ipcMain.handle('presets:list', () => presets.listPresets())
  ipcMain.handle('presets:save', (_event, payload) => presets.savePreset(payload))
  ipcMain.handle('presets:delete', (_event, id) => presets.deletePreset(id))

  ipcMain.handle('audio:renderLoopClip', async (_event, id, { loopStart, loopEnd, filters, crossfadeSeconds, speedPitch }) => {
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath) return { ok: false, error: 'Source file not found' }
    const result = await renderLoopClip({ id, inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch })
    if (result.ok) library.setLoopClipReady(id, { loopStart, loopEnd, filters, crossfadeSeconds, speedPitch })
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
