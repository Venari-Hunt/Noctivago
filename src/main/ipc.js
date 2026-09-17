import { app, ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as library from './library.js'
import * as presets from './presets.js'
import * as community from './community/client.js'
import {
  buildPortableBundle,
  writePortableBundle,
  prepareImport,
  importLocatedSound,
  clearImportSession,
  finalizeImport
} from './presetPortable.js'
import { renderLoopClip, probeDurationSeconds } from './ffmpeg/loopClip.js'
import { extractWaveformPeaks } from './ffmpeg/waveformPeaks.js'
import { computeBandEnergy } from './ffmpeg/bandEnergy.js'
import { suggestLoopPoints } from './ffmpeg/loopSuggest.js'
import { exportMix } from './ffmpeg/exportMix.js'
import { beginExport, endExport } from './exportState.js'
import { renderComposite } from './ffmpeg/composite.js'
import { getPlugins } from './plugins/registry.js'
import { invokePlugin } from './plugins/invoke.js'
import { getSettings, setMinimizeToTrayEnabled, setAutoInstallUpdatesEnabled, setWasPlayingOnClose, setEagerlyBakeOnImportEnabled, setSkipRemixLeaveConfirmEnabled, setFasterExportEnabled, setParallelMixdownEnabled, setExportVideoMode, setExportInfoFileEnabled, setYtDlpCookiesBrowser, setSleepTimerPrefs, setLastExportFolder, setExportLoopVideoPath, setExportVideoBackground, setExportVisualizationOptions, setExportImagePath, setExportImageMotion, setGlobalVolumePosition, setLastActivePresetId, setPresetAutosaveEnabled } from './settings.js'
import { getSleepTimer, startSleepTimer, cancelSleepTimer, runSleepTimerEndAction } from './sleepTimer.js'
import {
  setAutoUpdateEnabled,
  setAutoUpdateIntervalSeconds,
  checkForUpdatesNow,
  getUpdateState,
  getWhatsNew,
  getWhatsNewForCurrentVersion,
  downloadUpdateNow,
  dismissUpdate
} from './autoUpdate.js'
import { setTrayEnabled } from './tray.js'
import { setThumbarPlaying } from './thumbar.js'
import { watchNewFolder, unwatchFolder } from './watchFolders.js'
import { isFreesoundAvailable, searchSounds } from './freesound/client.js'
import { isYouTubeSearchAvailable, searchYouTube } from './ytdlp/search.js'

// Turns a preset name into a valid Windows folder/file name for
// export:pickDestination's auto-created per-run subfolder - strips
// characters NTFS/Explorer reject, collapses whitespace, and trims trailing
// dots/spaces (Windows silently drops those, which can otherwise produce a
// folder name that doesn't match what mkdirSync/path.join were given).
function sanitizeExportName(name) {
  const cleaned = String(name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return cleaned || 'Export'
}

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
  ipcMain.handle('autoUpdate:getState', () => getUpdateState())
  ipcMain.handle('autoUpdate:getWhatsNew', () => getWhatsNew())
  ipcMain.handle('autoUpdate:getWhatsNewCurrent', () => getWhatsNewForCurrentVersion())
  ipcMain.handle('autoUpdate:download', () => downloadUpdateNow())
  ipcMain.handle('autoUpdate:dismiss', (_event, version) => dismissUpdate(version))
  ipcMain.handle('settings:setMinimizeToTrayEnabled', (_event, enabled) => {
    const settings = setMinimizeToTrayEnabled(enabled)
    setTrayEnabled(enabled)
    return settings
  })
  ipcMain.handle('settings:setWasPlayingOnClose', (_event, wasPlaying) => setWasPlayingOnClose(wasPlaying))
  ipcMain.handle('settings:setEagerlyBakeOnImportEnabled', (_event, enabled) => setEagerlyBakeOnImportEnabled(enabled))
  ipcMain.handle('settings:setSkipRemixLeaveConfirmEnabled', (_event, enabled) => setSkipRemixLeaveConfirmEnabled(enabled))
  ipcMain.handle('settings:setFasterExportEnabled', (_event, enabled) => setFasterExportEnabled(enabled))
  ipcMain.handle('settings:setParallelMixdownEnabled', (_event, enabled) => setParallelMixdownEnabled(enabled))
  ipcMain.handle('settings:setExportVideoMode', (_event, mode) => setExportVideoMode(mode))
  ipcMain.handle('settings:setExportInfoFileEnabled', (_event, enabled) => setExportInfoFileEnabled(enabled))
  ipcMain.handle('settings:setExportLoopVideoPath', (_event, filePath) => setExportLoopVideoPath(filePath))
  ipcMain.handle('settings:setExportVideoBackground', (_event, mode) => setExportVideoBackground(mode))
  ipcMain.handle('settings:setExportVisualizationOptions', (_event, options) => setExportVisualizationOptions(options))
  ipcMain.handle('settings:setExportImagePath', (_event, filePath) => setExportImagePath(filePath))
  ipcMain.handle('settings:setExportImageMotion', (_event, motion) => setExportImageMotion(motion))
  ipcMain.handle('settings:setYtDlpCookiesBrowser', (_event, browser) => setYtDlpCookiesBrowser(browser))
  ipcMain.handle('settings:setGlobalVolumePosition', (_event, position) => setGlobalVolumePosition(position))
  ipcMain.handle('settings:setLastActivePresetId', (_event, id) => setLastActivePresetId(id))
  ipcMain.handle('settings:setPresetAutosaveEnabled', (_event, enabled) => setPresetAutosaveEnabled(enabled))

  ipcMain.handle('sleepTimer:get', () => getSleepTimer())
  ipcMain.handle('sleepTimer:start', (_event, { durationSeconds, action, minutes, mode, timeOfDay }) => {
    setSleepTimerPrefs({ minutes, action, mode, timeOfDay })
    return startSleepTimer(durationSeconds, action)
  })
  ipcMain.handle('sleepTimer:cancel', () => cancelSleepTimer())
  ipcMain.handle('sleepTimer:runEndAction', (_event, action) => runSleepTimerEndAction(action))

  ipcMain.handle('library:list', () => library.listSounds())
  ipcMain.handle('library:resolveCredits', (_event, ids) => library.resolveCredits(Array.isArray(ids) ? ids : []))
  ipcMain.handle('library:pickFile', () => library.pickFile())
  ipcMain.handle('library:pickFolder', () => library.pickFolder())
  ipcMain.handle('library:addSound', (_event, payload) => library.addSound(payload))
  ipcMain.handle('library:addRecordedSound', (_event, payload) => library.addRecordedSound(payload))
  ipcMain.handle('library:addSoundFromUrl', (event, payload) =>
    library.addSoundFromUrl(payload, (update) => {
      if (!event.sender.isDestroyed()) event.sender.send('library:addSoundFromUrlProgress', update)
    })
  )
  ipcMain.handle('library:addFolderSounds', (_event, folderPath, options) => library.addFolderSounds(folderPath, options))
  // Community presets (src/main/community/client.js).
  ipcMain.handle('community:getProfile', () => community.getProfile())
  ipcMain.handle('community:list', (_event, params) => community.listPresets(params))
  ipcMain.handle('community:listMine', () => community.listMyPresets())
  ipcMain.handle('community:download', (_event, id) => community.downloadPreset(id))
  ipcMain.handle('community:publish', (event, payload) =>
    community.publishPreset(payload, (update) => {
      if (!event.sender.isDestroyed()) event.sender.send('community:publishProgress', update)
    })
  )
  ipcMain.handle('community:delete', (_event, id) => community.deletePreset(id))
  ipcMain.handle('community:report', (_event, id, reason) => community.reportPreset(id, reason))
  ipcMain.handle('freesound:isAvailable', () => isFreesoundAvailable())
  ipcMain.handle('freesound:search', (_event, params) => searchSounds(params))
  ipcMain.handle('ytdlp:isSearchAvailable', () => isYouTubeSearchAvailable())
  ipcMain.handle('ytdlp:searchYouTube', (_event, params) => searchYouTube(params))
  ipcMain.handle('library:addSoundFromFreesound', (event, payload) =>
    library.addSoundFromFreesound(payload, (update) => {
      if (!event.sender.isDestroyed()) event.sender.send('library:addSoundFromFreesoundProgress', update)
    })
  )
  ipcMain.handle('library:updateMeta', (_event, id, meta) => library.updateMeta(id, meta))
  ipcMain.handle('library:updateLoopPoints', (_event, id, points) => library.updateLoopPoints(id, points))
  ipcMain.handle('library:updateFilters', (_event, id, filters) => library.updateFilters(id, filters))
  ipcMain.handle('library:updateVolume', (_event, id, volume) => library.updateVolume(id, volume))
  ipcMain.handle('library:updateIncluded', (_event, id, included) => library.updateIncluded(id, included))
  ipcMain.handle('library:updateCrossfade', (_event, id, crossfadeSeconds) => library.updateCrossfade(id, crossfadeSeconds))
  ipcMain.handle('library:updateFluctuation', (_event, id, fluctuation) => library.updateFluctuation(id, fluctuation))
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
  ipcMain.handle('library:addWatchedFolder', async (_event, folderPath, options) => {
    const { entry, added } = await library.addWatchedFolder(folderPath, options)
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
  ipcMain.handle('presets:updateWholeMix', (_event, id, wholeMix) => presets.updatePresetWholeMix(id, wholeMix))
  ipcMain.handle('presets:updateSounds', (_event, id, sounds) => presets.updatePresetSounds(id, sounds))
  ipcMain.handle('presets:updateGroups', (_event, id, groups) => presets.updatePresetGroups(id, groups, { markIncluded: library.updateIncluded }))
  ipcMain.handle('presets:updateSoundOverride', (_event, presetId, soundId, overridePatch) =>
    presets.updatePresetSoundOverride(presetId, soundId, overridePatch)
  )

  // Portable preset export/import (src/main/presetPortable.js) - a .ncvpreset
  // file (a zip) carrying the preset, every sound's settings, and the audio
  // itself. Phase-1 raw-JSON .ncvpreset files still import.
  ipcMain.handle('presets:export', async (_event, presetId) => {
    const bundle = buildPortableBundle(presetId)
    if (!bundle) return { ok: false, error: 'Preset not found.' }
    const result = await dialog.showSaveDialog({
      title: 'Export preset',
      defaultPath: `${bundle.manifest.name}.ncvpreset`,
      filters: [{ name: 'Noctívago preset', extensions: ['ncvpreset'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      const { soundCount, audioCount, totalBytes } = writePortableBundle(bundle, result.filePath)
      return { ok: true, path: result.filePath, soundCount, audioCount, totalBytes }
    } catch (err) {
      return { ok: false, error: `Could not write the file: ${err.message}` }
    }
  })

  ipcMain.handle('presets:pickImport', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import preset',
      properties: ['openFile'],
      // .zip: chat apps (WhatsApp, etc.) often append it when forwarding a
      // .ncvpreset, since the file is really a zip - readPortablePresetFile
      // sniffs the content, so the extension doesn't matter once it's picked.
      filters: [
        { name: 'Noctívago preset', extensions: ['ncvpreset', 'zip', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }

    try {
      return prepareImport(fs.readFileSync(result.filePaths[0]))
    } catch (err) {
      return { ok: false, error: `Could not read that file: ${err.message}` }
    }
  })

  ipcMain.handle('presets:resolveImportedSound', async (_event, portableSound) => {
    const result = await dialog.showOpenDialog({
      title: `Locate the audio file for "${portableSound?.name ?? 'sound'}"`,
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: library.AUDIO_EXTENSIONS }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const { soundId, reused } = importLocatedSound(result.filePaths[0], portableSound)
      return { ok: true, soundId, reused }
    } catch (err) {
      return { ok: false, error: `Could not import that file: ${err.message}` }
    }
  })

  ipcMain.handle('presets:finalizeImport', (_event, payload) => finalizeImport(payload))
  ipcMain.handle('presets:cancelImport', (_event, importSessionId) => {
    if (importSessionId) clearImportSession(importSessionId)
    return { ok: true }
  })

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
    if (!inputPath) return null
    try {
      // durationSeconds is normally learned lazily when a sound first plays
      // in the Mixer. A sound only ever opened in Composite/Remix may not
      // have it yet - probe it directly rather than returning no waveform,
      // and persist it (same as the Mixer's loadedmetadata path) so repeated
      // calls (e.g. Remix zoom) don't re-probe.
      let durationSeconds = entry?.durationSeconds
      if (durationSeconds == null) {
        durationSeconds = await probeDurationSeconds(inputPath)
        // probeDurationSeconds returns 0 (not null) if ffmpeg decodes no
        // samples - don't persist that as real metadata (it'd permanently
        // suppress the Mixer's own null-guarded re-probe and feed 0 into
        // loop-clip eligibility), matching library.js's `<= 0` eager-bake guard.
        if (durationSeconds > 0 && entry) library.updateMeta(id, { durationSeconds })
      }
      if (!(durationSeconds > 0)) return null
      return await extractWaveformPeaks({
        inputPath,
        durationSeconds,
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

  ipcMain.handle('audio:suggestLoopPoints', async (_event, id, options) => {
    const entry = library.listSounds().find((s) => s.id === id)
    const inputPath = library.getPlaybackPathForId(id)
    if (!inputPath) return { ok: false, error: 'Source file not found' }
    try {
      return await suggestLoopPoints(inputPath, entry?.durationSeconds, options ?? {})
    } catch (err) {
      console.error('Loop-point suggestion failed', id, err)
      return { ok: false, error: 'Analysis failed' }
    }
  })

  // Picks a parent folder rather than a filename directly (was a
  // showSaveDialog) so every export can auto-create its own subfolder named
  // after the preset - "everything exported for that run" (the audio file,
  // the optional black-screen video, the optional info.txt below) lands
  // together instead of loose files piling up at the destination root, and a
  // second export of the same preset naturally lands back in the same place rather
  // than needing the exact filename re-typed. exportMix.js already
  // mkdirSync(..., {recursive:true}) on the returned path's directory, so
  // the subfolder needs no separate creation step here.
  //
  // `fileName` (the file's own basename, separate from `defaultName`'s
  // folder) carries a bit more than the bare preset name - inbox request:
  // "the filename when exporting presets as audios should carry some of the
  // characteristics of the export, e.g. {preset name} {video kind} {export
  // length}" - built by the Export plugin (plugins/export/index.js, which
  // already knows the video mode/duration) and just sanitized here, same as
  // the folder name. Falls back to `defaultName` for any older caller that
  // doesn't pass it.
  ipcMain.handle('export:pickDestination', async (_event, { defaultName, fileName, format }) => {
    const settings = getSettings()
    const defaultFolder = settings.lastExportFolder && fs.existsSync(settings.lastExportFolder)
      ? settings.lastExportFolder
      : undefined
    const result = await dialog.showOpenDialog({
      title: 'Choose export destination',
      defaultPath: defaultFolder,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const destDir = result.filePaths[0]
    setLastExportFolder(destDir)
    const folderName = sanitizeExportName(defaultName)
    const baseFileName = sanitizeExportName(fileName || defaultName)
    return path.join(destDir, folderName, `${baseFileName}.${format}`)
  })

  // The Export tab's "info file" toggle (v0.1.140) - the renderer already has
  // everything worth describing (preset name, per-sound tags, chosen format/
  // fade/output-mode) from the same data it just used to run the export, so
  // it builds the plain-text content itself; this handler is only the
  // write-to-disk step the renderer can't do directly (no fs access, per this
  // app's sandboxed-renderer security model - see CLAUDE.md's Plugins
  // section). Written into the same per-preset subfolder export:run's
  // outputPath already lives in - that folder exists by the time this is
  // called (export:run only returns after the audio/video render finishes),
  // so no mkdirSync needed here.
  ipcMain.handle('export:writeInfoFile', async (_event, { outputPath, content }) => {
    try {
      const infoPath = path.join(path.dirname(outputPath), 'info.txt')
      fs.writeFileSync(infoPath, content, 'utf8')
      return { ok: true, infoPath }
    } catch (err) {
      console.error('export:writeInfoFile failed', err)
      return { ok: false, error: err.message }
    }
  })

  // Reported directly after a real overnight export ("i dozed off and didn't
  // get the log. Make the text on the log box be exported to the final
  // folder"): the on-screen per-step log (with its real wall-clock
  // timestamps and per-phase timings, see closeLastLogLineTiming/v0.1.150)
  // is only ever visible while someone is actually watching the tab - a long
  // unattended export loses it the moment the app closes or the tab
  // navigates away. Same shape as writeInfoFile just above (renderer already
  // has the exact text on screen, this is only the write-to-disk step it
  // can't do itself) - written unconditionally (success or failure) since
  // exportMix() creates the destination subfolder as the very first thing it
  // does, before any real render work that could fail.
  ipcMain.handle('export:writeLogFile', async (_event, { outputPath, content }) => {
    try {
      const logPath = path.join(path.dirname(outputPath), 'export-log.txt')
      // Owner request (2026-09-16), after two export logs from different
      // builds were compared by hand to measure a speed fix: a log is only
      // useful as a before/after datapoint if you can tell which build
      // produced it. Stamped here rather than in the renderer's own log text
      // so it reflects the real running build (app.getVersion()) and can't
      // drift from it, and so it lands in the file even though the on-screen
      // log - which is per-step progress, not a header - never shows it.
      const header = `Noctívago v${app.getVersion()} — export log — ${new Date().toISOString()}\n\n`
      fs.writeFileSync(logPath, header + content, 'utf8')
      return { ok: true, logPath }
    } catch (err) {
      console.error('export:writeLogFile failed', err)
      return { ok: false, error: err.message }
    }
  })

  // Export tab (v0.1.141, Board #next item #4): "associate a chosen video
  // file to loop under the audio instead of/alongside the flat black
  // screen." Persisted immediately on pick (exportLoopVideoPath) rather than
  // threaded through export:run's own payload, mirroring how exportVideoMode
  // itself is already read server-side from settings rather than passed by
  // the renderer - one less thing for the Export tab to round-trip on every
  // run. defaultPath opens at the folder of whatever's already chosen, if
  // anything, for a quick re-pick of a different file in the same place.
  ipcMain.handle('export:pickVideoFile', async () => {
    const settings = getSettings()
    const defaultPath = settings.exportLoopVideoPath && fs.existsSync(settings.exportLoopVideoPath)
      ? path.dirname(settings.exportLoopVideoPath)
      : undefined
    const result = await dialog.showOpenDialog({
      title: 'Choose a video to loop under the export',
      defaultPath,
      properties: ['openFile'],
      filters: [
        { name: 'Video files', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'wmv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    setExportLoopVideoPath(result.filePaths[0])
    return result.filePaths[0]
  })

  // Same shape as export:pickVideoFile just above, for the "loop an image"
  // video background (v0.1.152) - a still image with an optional spin/DVD-
  // bounce motion instead of a moving video file.
  ipcMain.handle('export:pickImageFile', async () => {
    const settings = getSettings()
    const defaultPath = settings.exportImagePath && fs.existsSync(settings.exportImagePath)
      ? path.dirname(settings.exportImagePath)
      : undefined
    const result = await dialog.showOpenDialog({
      title: 'Choose an image to loop under the export',
      defaultPath,
      properties: ['openFile'],
      filters: [
        { name: 'Image files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    setExportImagePath(result.filePaths[0])
    return result.filePaths[0]
  })

  // sounds: [{ soundId, playMode, loopStart, loopEnd, filters, speedPitch,
  // crossfadeSeconds, volume, events }] - the renderer's Export plugin
  // already resolved playMode/filters/etc from the library and ran the
  // event simulation (pure JS, no IPC needed for that part); this handler
  // only resolves each soundId to a real file path (the one thing the
  // renderer shouldn't need direct filesystem knowledge for, matching
  // audio:renderLoopClip's own id -> path boundary) before handing
  // everything to the actual ffmpeg pipeline.
  ipcMain.handle('export:run', async (event, { sounds, durationSeconds, format, wholeMixFilters, groups, fadeInSeconds, fadeOutSeconds, outputPath }) => {
    const resolvedSounds = sounds
      .map((s) => ({
        ...s,
        inputPath: library.getPlaybackPathForId(s.soundId),
        // a loop sound whose already-baked clip still matches its current
        // trim/filters/crossfade/speed can be reused as-is (exportMix skips
        // re-baking it) - null when stale or never baked. `s` itself is
        // already the plugin's fully-resolved effective sound (baseline
        // merged with this preset's own override, if any - see
        // plugins/export/index.js), so passing it straight through as the
        // override argument checks eligibility against the right settings
        // for per-preset overrides (planned 2026-09-12).
        cachedClipPath: library.getLoopClipPathForId(s.soundId, s)
      }))
      .filter((s) => s.inputPath)
    if (resolvedSounds.length === 0) return { ok: false, error: 'No exportable sounds in this preset' }
    // Throttle so a fast render doesn't flood the renderer with tick events;
    // a 'step' always goes through so the verbose log stays complete.
    let lastSent = 0
    const onProgress = (payload) => {
      const now = Date.now()
      if (payload.type === 'step' || now - lastSent > 120) {
        lastSent = now
        if (!event.sender.isDestroyed()) event.sender.send('export:progress', payload)
      }
    }
    // Bracketed around the whole bake, not just the ffmpeg calls, so
    // autoUpdate.js's guard covers the entire window an export could still
    // be running - see exportState.js.
    beginExport()
    try {
      const settings = getSettings()
      return await exportMix({
        sounds: resolvedSounds,
        durationSeconds,
        format,
        wholeMixFilters,
        groups,
        fadeInSeconds,
        fadeOutSeconds,
        outputPath,
        onProgress,
        fasterExport: settings.fasterExport,
        parallelMixdown: settings.parallelMixdown,
        videoMode: settings.exportVideoMode,
        videoBackground: settings.exportVideoBackground,
        loopVideoPath: settings.exportLoopVideoPath,
        imagePath: settings.exportImagePath,
        imageMotion: settings.exportImageMotion,
        visualization: {
          type: settings.exportVisualizationType,
          color: settings.exportVisualizationColor,
          bgColor: settings.exportVisualizationBgColor,
          palette: settings.exportVisualizationPalette,
          size: settings.exportVisualizationSize,
          fps: settings.exportVisualizationFps
        }
      })
    } finally {
      endExport()
    }
  })

  // members: [{soundId, delayMs, inSec, outSec, volume}] - resolves each to
  // the real, current data the Composite bake needs, mirroring export:run's
  // own id -> path/data resolution boundary. The trim (inSec/outSec) is the
  // Composite timeline's own, independent of the sound's Remix loop points;
  // the member's Remix filters/speedPitch still bake in. Older composites
  // saved before the timeline (only {soundId, delayMs}) fall back to the
  // sound's Remix trim, then its full duration.
  function resolveCompositeMembers(members) {
    return members
      .map((m) => {
        const entry = library.listSounds().find((s) => s.id === m.soundId)
        const inputPath = library.getPlaybackPathForId(m.soundId)
        if (!entry || !inputPath) return null
        const fullEnd = entry.loopEnd ?? entry.durationSeconds ?? 0
        const loopStart = m.inSec != null ? Math.max(0, m.inSec) : entry.loopStart ?? 0
        let loopEnd = m.outSec != null ? m.outSec : fullEnd
        if (entry.durationSeconds != null) loopEnd = Math.min(loopEnd, entry.durationSeconds)
        if (loopEnd <= loopStart) loopEnd = loopStart + 0.05
        return {
          inputPath,
          loopStart,
          loopEnd,
          filters: entry.filters ?? {},
          speedPitch: entry.speedPitch ?? null,
          delayMs: m.delayMs ?? 0,
          volume: m.volume ?? 1
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
