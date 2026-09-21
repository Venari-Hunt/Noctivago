import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // app.isPackaged is a main-process-only property - preload can't reach it
  // directly through a plain `electron` import (that surface only exposes
  // ipcRenderer/contextBridge/etc. here), so this goes through IPC instead.
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoUpdateEnabled', enabled),
    setAutoUpdateIntervalSeconds: (seconds) => ipcRenderer.invoke('settings:setAutoUpdateIntervalSeconds', seconds),
    setAutoInstallUpdatesEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoInstallUpdatesEnabled', enabled),
    setMinimizeToTrayEnabled: (enabled) => ipcRenderer.invoke('settings:setMinimizeToTrayEnabled', enabled),
    setWasPlayingOnClose: (wasPlaying) => ipcRenderer.invoke('settings:setWasPlayingOnClose', wasPlaying),
    setEagerlyBakeOnImportEnabled: (enabled) => ipcRenderer.invoke('settings:setEagerlyBakeOnImportEnabled', enabled),
    setSkipRemixLeaveConfirmEnabled: (enabled) => ipcRenderer.invoke('settings:setSkipRemixLeaveConfirmEnabled', enabled),
    setFasterExportEnabled: (enabled) => ipcRenderer.invoke('settings:setFasterExportEnabled', enabled),
    setParallelMixdownEnabled: (enabled) => ipcRenderer.invoke('settings:setParallelMixdownEnabled', enabled),
    setExportVideoMode: (mode) => ipcRenderer.invoke('settings:setExportVideoMode', mode),
    setExportInfoFileEnabled: (enabled) => ipcRenderer.invoke('settings:setExportInfoFileEnabled', enabled),
    setExportInfoPrompt: (prompt) => ipcRenderer.invoke('settings:setExportInfoPrompt', prompt),
    setExportLoopVideoPath: (filePath) => ipcRenderer.invoke('settings:setExportLoopVideoPath', filePath),
    setExportVideoBackground: (mode) => ipcRenderer.invoke('settings:setExportVideoBackground', mode),
    setExportVisualizationOptions: (options) => ipcRenderer.invoke('settings:setExportVisualizationOptions', options),
    setExportImagePath: (filePath) => ipcRenderer.invoke('settings:setExportImagePath', filePath),
    setExportImageMotion: (motion) => ipcRenderer.invoke('settings:setExportImageMotion', motion),
    setYtDlpCookiesBrowser: (browser) => ipcRenderer.invoke('settings:setYtDlpCookiesBrowser', browser),
    setGlobalVolumePosition: (position) => ipcRenderer.invoke('settings:setGlobalVolumePosition', position),
    setLastActivePresetId: (id) => ipcRenderer.invoke('settings:setLastActivePresetId', id),
    setPresetAutosaveEnabled: (enabled) => ipcRenderer.invoke('settings:setPresetAutosaveEnabled', enabled)
  },
  autoUpdate: {
    checkNow: () => ipcRenderer.invoke('autoUpdate:checkNow'),
    getState: () => ipcRenderer.invoke('autoUpdate:getState'),
    getWhatsNew: () => ipcRenderer.invoke('autoUpdate:getWhatsNew'),
    getWhatsNewCurrent: () => ipcRenderer.invoke('autoUpdate:getWhatsNewCurrent'),
    download: () => ipcRenderer.invoke('autoUpdate:download'),
    dismiss: (version) => ipcRenderer.invoke('autoUpdate:dismiss', version),
    // Feeds the in-app Update modal (src/renderer/core/UpdateModal.js).
    // callback(channel, payload) for each of the update:* events the main
    // process pushes. Returns an unsubscribe function, matching the other
    // listener-style preload APIs.
    onEvent: (callback) => {
      const channels = [
        'update:checking',
        'update:available',
        'update:progress',
        'update:downloaded',
        'update:not-available',
        'update:error'
      ]
      const registered = channels.map((channel) => {
        const listener = (_event, payload) => callback(channel, payload)
        ipcRenderer.on(channel, listener)
        return [channel, listener]
      })
      return () => registered.forEach(([channel, listener]) => ipcRenderer.removeListener(channel, listener))
    }
  },
  playback: {
    // One-way, no response expected - see ipc.js's 'playback:reportState'
    // handler for what this drives (the taskbar thumbnail toolbar button).
    reportState: (playing) => ipcRenderer.send('playback:reportState', playing)
  },
  sleepTimer: {
    get: () => ipcRenderer.invoke('sleepTimer:get'),
    start: (payload) => ipcRenderer.invoke('sleepTimer:start', payload),
    cancel: () => ipcRenderer.invoke('sleepTimer:cancel'),
    runEndAction: (action) => ipcRenderer.invoke('sleepTimer:runEndAction', action),
    onElapsed: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('sleep-timer:elapsed', listener)
      return () => ipcRenderer.removeListener('sleep-timer:elapsed', listener)
    }
  },
  tray: {
    // The tray's "Play / Pause" menu item has no direct line to renderer
    // playback state (that's Mixer-only, in tabs/mixer/index.js) - it just
    // asks the renderer to do what the toolbar's own Play/Pause button
    // would do. Returns an unsubscribe function, matching the general
    // pattern for listener-style preload APIs.
    onTogglePlayPause: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('tray:togglePlayPause', listener)
      return () => ipcRenderer.removeListener('tray:togglePlayPause', listener)
    }
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    // [{ id, name, source }] for the export's credits (fills in missing
    // Freesound license/title details first).
    resolveCredits: (ids) => ipcRenderer.invoke('library:resolveCredits', ids),
    pickFile: () => ipcRenderer.invoke('library:pickFile'),
    pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
    addSound: (payload) => ipcRenderer.invoke('library:addSound', payload),
    addRecordedSound: (payload) => ipcRenderer.invoke('library:addRecordedSound', payload),
    addSoundFromUrl: (payload) => ipcRenderer.invoke('library:addSoundFromUrl', payload),
    // Stops a link download in flight. A YouTube import can run for minutes
    // (YouTube throttles long uploads to roughly playback speed), so it has
    // to be interruptible. Resolves true if something was actually running.
    cancelAddSoundFromUrl: () => ipcRenderer.invoke('library:cancelAddSoundFromUrl'),
    // Progress while a link downloads: { type:'step'|'status', message } or
    // { type:'progress', percent } (0..100). Returns an unsubscribe fn.
    onAddSoundFromUrlProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('library:addSoundFromUrlProgress', listener)
      return () => ipcRenderer.removeListener('library:addSoundFromUrlProgress', listener)
    },
    addFolderSounds: (folderPath, options) => ipcRenderer.invoke('library:addFolderSounds', folderPath, options),
    addSoundFromFreesound: (payload) => ipcRenderer.invoke('library:addSoundFromFreesound', payload),
    onAddSoundFromFreesoundProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('library:addSoundFromFreesoundProgress', listener)
      return () => ipcRenderer.removeListener('library:addSoundFromFreesoundProgress', listener)
    },
    updateMeta: (id, meta) => ipcRenderer.invoke('library:updateMeta', id, meta),
    updateLoopPoints: (id, points) => ipcRenderer.invoke('library:updateLoopPoints', id, points),
    updateFilters: (id, filters) => ipcRenderer.invoke('library:updateFilters', id, filters),
    updateVolume: (id, volume) => ipcRenderer.invoke('library:updateVolume', id, volume),
    updateIncluded: (id, included) => ipcRenderer.invoke('library:updateIncluded', id, included),
    updateCrossfade: (id, crossfadeSeconds) => ipcRenderer.invoke('library:updateCrossfade', id, crossfadeSeconds),
    updateFluctuation: (id, fluctuation) => ipcRenderer.invoke('library:updateFluctuation', id, fluctuation),
    updateTags: (id, tags) => ipcRenderer.invoke('library:updateTags', id, tags),
    updateSpeedPitch: (id, speedPitch) => ipcRenderer.invoke('library:updateSpeedPitch', id, speedPitch),
    updatePlayMode: (id, playMode) => ipcRenderer.invoke('library:updatePlayMode', id, playMode),
    updateScatterConfig: (id, scatter) => ipcRenderer.invoke('library:updateScatterConfig', id, scatter),
    updateSchedule: (id, schedule) => ipcRenderer.invoke('library:updateSchedule', id, schedule),
    reorderSounds: (orderedIds) => ipcRenderer.invoke('library:reorderSounds', orderedIds),
    rename: (id, name) => ipcRenderer.invoke('library:rename', id, name),
    duplicateSound: (id, options) => ipcRenderer.invoke('library:duplicateSound', id, options),
    relink: (id) => ipcRenderer.invoke('library:relink', id),
    remove: (id) => ipcRenderer.invoke('library:remove', id),
    listWatchedFolders: () => ipcRenderer.invoke('library:listWatchedFolders'),
    pickWatchFolder: () => ipcRenderer.invoke('library:pickWatchFolder'),
    addWatchedFolder: (folderPath, options) => ipcRenderer.invoke('library:addWatchedFolder', folderPath, options),
    removeWatchedFolder: (id) => ipcRenderer.invoke('library:removeWatchedFolder', id),
    // Fires whenever a watched folder auto-imports a new sound (initial
    // scan or live fs.watch pickup) - lets an already-mounted tab refresh
    // without the user needing to switch away and back first.
    onChanged: (callback) => {
      const listener = () => callback()
      ipcRenderer.on('library:changed', listener)
      return () => ipcRenderer.removeListener('library:changed', listener)
    }
  },
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (payload) => ipcRenderer.invoke('presets:save', payload),
    delete: (id) => ipcRenderer.invoke('presets:delete', id),
    updateWholeMix: (id, wholeMix) => ipcRenderer.invoke('presets:updateWholeMix', id, wholeMix),
    updateSounds: (id, sounds) => ipcRenderer.invoke('presets:updateSounds', id, sounds),
    updateGroups: (id, groups) => ipcRenderer.invoke('presets:updateGroups', id, groups),
    updateSoundOverride: (presetId, soundId, overridePatch) => ipcRenderer.invoke('presets:updateSoundOverride', presetId, soundId, overridePatch),
    export: (presetId) => ipcRenderer.invoke('presets:export', presetId),
    pickImport: () => ipcRenderer.invoke('presets:pickImport'),
    resolveImportedSound: (portableSound) => ipcRenderer.invoke('presets:resolveImportedSound', portableSound),
    finalizeImport: (payload) => ipcRenderer.invoke('presets:finalizeImport', payload),
    cancelImport: (importSessionId) => ipcRenderer.invoke('presets:cancelImport', importSessionId)
  },
  audio: {
    renderLoopClip: (id, points) => ipcRenderer.invoke('audio:renderLoopClip', id, points),
    getWaveformPeaks: (id, targetWidth, windowStart, windowEnd) =>
      ipcRenderer.invoke('audio:getWaveformPeaks', id, targetWidth, windowStart, windowEnd),
    getBandEnergy: (id, options) => ipcRenderer.invoke('audio:getBandEnergy', id, options),
    getSpectrogram: (id, options) => ipcRenderer.invoke('audio:getSpectrogram', id, options),
    suggestLoopPoints: (id, options) => ipcRenderer.invoke('audio:suggestLoopPoints', id, options)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    describe: () => ipcRenderer.invoke('plugins:describe'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    setRestrictedMode: (on) => ipcRenderer.invoke('plugins:setRestrictedMode', on),
    dismissRecommended: () => ipcRenderer.invoke('plugins:dismissRecommended'),
    setAutoUpdate: (on) => ipcRenderer.invoke('plugins:setAutoUpdate', on),
    takeStartupNotices: () => ipcRenderer.invoke('plugins:takeStartupNotices'),
    isExportRunning: () => ipcRenderer.invoke('plugins:isExportRunning'),
    onAutoUpdated: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('plugins:autoUpdated', listener)
      return () => ipcRenderer.removeListener('plugins:autoUpdated', listener)
    },
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('plugins:changed', listener)
      return () => ipcRenderer.removeListener('plugins:changed', listener)
    },
    invoke: (pluginId, method, ...args) => ipcRenderer.invoke('plugin:invoke', pluginId, method, args)
  },
  pluginStore: {
    list: () => ipcRenderer.invoke('pluginStore:list'),
    checkLatest: (id) => ipcRenderer.invoke('pluginStore:checkLatest', id),
    readme: (id) => ipcRenderer.invoke('pluginStore:readme', id),
    install: (id) => ipcRenderer.invoke('pluginStore:install', id),
    uninstall: (id) => ipcRenderer.invoke('pluginStore:uninstall', id),
    restartApp: () => ipcRenderer.invoke('pluginStore:restartApp')
  },
  export: {
    pickDestination: (options) => ipcRenderer.invoke('export:pickDestination', options),
    pickVideoFile: () => ipcRenderer.invoke('export:pickVideoFile'),
    pickImageFile: () => ipcRenderer.invoke('export:pickImageFile'),
    run: (payload) => ipcRenderer.invoke('export:run', payload),
    writeInfoFile: (payload) => ipcRenderer.invoke('export:writeInfoFile', payload),
    writeLogFile: (payload) => ipcRenderer.invoke('export:writeLogFile', payload),
    // Progress updates while an export renders: { type:'step', label, fraction }
    // or { type:'tick', fraction } (fraction 0..1). Returns an unsubscribe fn.
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('export:progress', listener)
      return () => ipcRenderer.removeListener('export:progress', listener)
    }
  },
  composite: {
    create: (payload) => ipcRenderer.invoke('composite:create', payload),
    rebake: (payload) => ipcRenderer.invoke('composite:rebake', payload)
  },
  community: {
    getProfile: () => ipcRenderer.invoke('community:getProfile'),
    list: (params) => ipcRenderer.invoke('community:list', params),
    listMine: () => ipcRenderer.invoke('community:listMine'),
    download: (id) => ipcRenderer.invoke('community:download', id),
    publish: (payload) => ipcRenderer.invoke('community:publish', payload),
    delete: (id) => ipcRenderer.invoke('community:delete', id),
    report: (id, reason) => ipcRenderer.invoke('community:report', id, reason),
    onPublishProgress: (callback) => {
      const listener = (_event, update) => callback(update)
      ipcRenderer.on('community:publishProgress', listener)
      return () => ipcRenderer.removeListener('community:publishProgress', listener)
    }
  },
  freesound: {
    isAvailable: () => ipcRenderer.invoke('freesound:isAvailable'),
    search: (params) => ipcRenderer.invoke('freesound:search', params)
  },
  ytdlp: {
    isSearchAvailable: () => ipcRenderer.invoke('ytdlp:isSearchAvailable'),
    searchYouTube: (params) => ipcRenderer.invoke('ytdlp:searchYouTube', params)
  }
}

contextBridge.exposeInMainWorld('noctivago', api)
