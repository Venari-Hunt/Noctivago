import { app, ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as library from './library.js'
import * as presets from './presets.js'
import { renderLoopClip } from './ffmpeg/loopClip.js'
import { extractWaveformPeaks } from './ffmpeg/waveformPeaks.js'
import { computeBandEnergy } from './ffmpeg/bandEnergy.js'
import { exportMix } from './ffmpeg/exportMix.js'
import { renderComposite } from './ffmpeg/composite.js'
import { getPlugins } from './plugins/registry.js'
import { invokePlugin } from './plugins/invoke.js'
import { getSettings, setMinimizeToTrayEnabled, setAutoInstallUpdatesEnabled, setWasPlayingOnClose, setEagerlyBakeOnImportEnabled, setSkipRemixLeaveConfirmEnabled } from './settings.js'
import { setAutoUpdateEnabled, setAutoUpdateIntervalSeconds, checkForUpdatesNow } from './autoUpdate.js'
import { setTrayEnabled } from './tray.js'
import { setThumbarPlaying } from './thumbar.js'
import { watchNewFolder, unwatchFolder } from './watchFolders.js'

export function registerIpcHandlers() {
  ipcMain.handle('app:isPackaged', () => app.isPackaged)

  // One-way: the renderer reports every play/pause transition so the
  // Windows taskbar thumbnail toolbar button (src/main/thumbar.js) can keep
  // its icon in sync, mirroring how settings:setWasPlayingOnClose is
  // already called from the same call sites for resume-on-launch.
  ipcMain.on('playback:reportState', (_event, playing) => setThumbarPlaying(playing))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:setAutoUpdateEnabled', (_event, enabled) => setAutoUpdateEnabled(enabled))
  ipcMain.handle('settings:setAutoUpdateIntervalSeconds', (_event, seconds) => setAutoUpdateIntervalSeconds(seconds))
  ipcMain.handle('settings:setAutoInstallUpdatesEnabled', (_event, enabled) => setAutoInstallUpdatesEnabled(enabled))
  ipcMain.handle('autoUpdate:checkNow', () => checkForUpdatesNow())
  ipcMain.handle('settings:setMinimizeToTrayEnabled', (_event, enabled) => {
    const settings = setMinimizeToTrayEnabled(enabled)
    setTrayEnabled(enabled)
    return settings
  })
  ipcMain.handle('settings:setWasPlayingOnClose', (_event, wasPlaying) => setWasPlayingOnClose(wasPlaying))
  ipcMain.handle('settings:setEagerlyBakeOnImportEnabled', (_event, enabled) => setEagerlyBakeOnImportEnabled(enabled))
  ipcMain.handle('settings:setSkipRemixLeaveConfirmEnabled', (_event, enabled) => setSkipRemixLeaveConfirmEnabled(enabled))

  ipcMain.handle('library:list', () => library.listSounds())
  ipcMain.handle('library:pickFile', () => library.pickFile())
  ipcMain.handle('library:pickFolder', () => library.pickFolder())
  ipcMain.handle('library:addSound', (_event, payload) => library.addSound(payload))
  ipcMain.handle('library:addRecordedSound', (_event, payload) => library.addRecordedSound(payload))
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
  ipcMain.handle('library:updateSchedule', (_event, id, schedule) => library.updateSchedule(id, schedule))
  ipcMain.handle('library:reorderSounds', (_event, orderedIds) => library.reorderSounds(orderedIds))
  ipcMain.handle('library:rename', (_event, id, name) => library.rename(id, name))
  ipcMain.handle('library:duplicateSound', (_event, id, options) => library.duplicateSound(id, options))
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

  ipcMain.handle('audio:getWaveformPeaks', async (_event, id, targetWidth, windowStart, windowEnd) => {
    const entry = library.listSounds().find((s) => s.id === id)
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath || entry?.durationSeconds == null) return null
    try {
      return await extractWaveformPeaks({
        inputPath,
        durationSeconds: entry.durationSeconds,
        targetWidth,
        windowStart,
        windowEnd
      })
    } catch (err) {
      console.error('Waveform extraction failed', id, err)
      return null
    }
  })

  ipcMain.handle('audio:getBandEnergy', async (_event, id, { loopStart, loopEnd, freqs }) => {
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath) return null
    try {
      return await computeBandEnergy(inputPath, { loopStart, loopEnd, freqs })
    } catch (err) {
      console.error('Band energy analysis failed', id, err)
      return null
    }
  })

  ipcMain.handle('export:pickDestination', async (_event, { defaultName, format }) => {
    const result = await dialog.showSaveDialog({
      title: 'Export mix',
      defaultPath: `${defaultName}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // sounds: [{ soundId, playMode, loopStart, loopEnd, filters, speedPitch,
  // crossfadeSeconds, volume, events }] - the renderer's Export plugin
  // already resolved playMode/filters/etc from the library and ran the
  // event simulation (pure JS, no IPC needed for that part); this handler
  // only resolves each soundId to a real file path (the one thing the
  // renderer shouldn't need direct filesystem knowledge for, matching
  // audio:renderLoopClip's own id -> path boundary) before handing
  // everything to the actual ffmpeg pipeline.
  ipcMain.handle('export:run', async (_event, { sounds, durationSeconds, format, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath }) => {
    const resolvedSounds = sounds
      .map((s) => ({ ...s, inputPath: library.getPlaybackPathForId(s.soundId) }))
      .filter((s) => s.inputPath)
    if (resolvedSounds.length === 0) return { ok: false, error: 'No exportable sounds in this preset' }
    return exportMix({ sounds: resolvedSounds, durationSeconds, format, wholeMixFilters, fadeInSeconds, fadeOutSeconds, outputPath })
  })

  // members: [{soundId, delayMs}] - resolves each to the real, current data
  // (filters/trim/speedPitch) the Composite bake needs, mirroring
  // export:run's own id -> path/data resolution boundary.
  function resolveCompositeMembers(members) {
    return members
      .map((m) => {
        const entry = library.listSounds().find((s) => s.id === m.soundId)
        const inputPath = library.getPlaybackPathForId(m.soundId)
        if (!entry || !inputPath) return null
        return {
          inputPath,
          loopStart: entry.loopStart ?? 0,
          loopEnd: entry.loopEnd ?? entry.durationSeconds ?? 0,
          filters: entry.filters ?? {},
          speedPitch: entry.speedPitch ?? null,
          delayMs: m.delayMs ?? 0
        }
      })
      .filter(Boolean)
  }

  ipcMain.handle('composite:create', async (_event, { name, members }) => {
    const resolved = resolveCompositeMembers(members)
    if (resolved.length < 2) return { ok: false, error: 'Choose at least two sounds' }

    const tmpDir = path.join(app.getPath('userData'), 'export-tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpOutputPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`)
    const result = await renderComposite({ members: resolved, outputPath: tmpOutputPath })
    if (!result.ok) return result

    try {
      const entry = library.addSound({ path: tmpOutputPath, name, keepCopy: true })
      library.markAsComposite(entry.id, members)
      return { ok: true, entry: library.listSounds().find((s) => s.id === entry.id) }
    } finally {
      try {
        if (fs.existsSync(tmpOutputPath)) fs.unlinkSync(tmpOutputPath)
      } catch {
        // best-effort cleanup
      }
    }
  })

  ipcMain.handle('composite:rebake', async (_event, { id, name, members }) => {
    const resolved = resolveCompositeMembers(members)
    if (resolved.length < 2) return { ok: false, error: 'Choose at least two sounds' }
    const outputPath = library.getPlaybackPathForId(id)
    if (!outputPath) return { ok: false, error: 'Composite sound not found' }

    const result = await renderComposite({ members: resolved, outputPath })
    if (!result.ok) return result
    library.updateComposite(id, { name, members })
    return { ok: true, entry: library.listSounds().find((s) => s.id === id) }
  })

  ipcMain.handle('plugins:list', () => getPlugins().map((p) => ({ id: p.id, manifest: p.manifest })))

  ipcMain.handle('plugin:invoke', (_event, pluginId, method, args) => invokePlugin(pluginId, method, args))
}
