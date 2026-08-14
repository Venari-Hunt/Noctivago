import { ipcMain } from 'electron'
import * as library from './library.js'
import * as presets from './presets.js'
import { renderLoopClip } from './ffmpeg/loopClip.js'
import { extractWaveformPeaks } from './ffmpeg/waveformPeaks.js'

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

  ipcMain.handle('audio:renderLoopClip', async (_event, id, { loopStart, loopEnd }) => {
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath) return { ok: false, error: 'Source file not found' }
    const result = await renderLoopClip({ id, inputPath, loopStart, loopEnd })
    if (result.ok) library.setLoopClipReady(id, { loopStart, loopEnd })
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
}
