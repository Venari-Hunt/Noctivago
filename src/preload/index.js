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
    setSkipRemixLeaveConfirmEnabled: (enabled) => ipcRenderer.invoke('settings:setSkipRemixLeaveConfirmEnabled', enabled)
  },
  autoUpdate: {
    checkNow: () => ipcRenderer.invoke('autoUpdate:checkNow'),
    getState: () => ipcRenderer.invoke('autoUpdate:getState'),
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
    pickFile: () => ipcRenderer.invoke('library:pickFile'),
    pickFolder: () => ipcRenderer.invoke('library:pickFolder'),
    addSound: (payload) => ipcRenderer.invoke('library:addSound', payload),
    addRecordedSound: (payload) => ipcRenderer.invoke('library:addRecordedSound', payload),
    addFolderSounds: (folderPath, options) => ipcRenderer.invoke('library:addFolderSounds', folderPath, options),
    updateMeta: (id, meta) => ipcRenderer.invoke('library:updateMeta', id, meta),
    updateLoopPoints: (id, points) => ipcRenderer.invoke('library:updateLoopPoints', id, points),
    updateFilters: (id, filters) => ipcRenderer.invoke('library:updateFilters', id, filters),
    updateVolume: (id, volume) => ipcRenderer.invoke('library:updateVolume', id, volume),
    updateIncluded: (id, included) => ipcRenderer.invoke('library:updateIncluded', id, included),
    updateCrossfade: (id, crossfadeSeconds) => ipcRenderer.invoke('library:updateCrossfade', id, crossfadeSeconds),
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
    export: (presetId) => ipcRenderer.invoke('presets:export', presetId),
    pickImport: () => ipcRenderer.invoke('presets:pickImport'),
    resolveImportedSound: (portableSound) => ipcRenderer.invoke('presets:resolveImportedSound', portableSound)
  },
  audio: {
    renderLoopClip: (id, points) => ipcRenderer.invoke('audio:renderLoopClip', id, points),
    getWaveformPeaks: (id, targetWidth, windowStart, windowEnd) =>
      ipcRenderer.invoke('audio:getWaveformPeaks', id, targetWidth, windowStart, windowEnd),
    getBandEnergy: (id, options) => ipcRenderer.invoke('audio:getBandEnergy', id, options)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    invoke: (pluginId, method, ...args) => ipcRenderer.invoke('plugin:invoke', pluginId, method, args)
  },
  export: {
    pickDestination: (options) => ipcRenderer.invoke('export:pickDestination', options),
    run: (payload) => ipcRenderer.invoke('export:run', payload)
  },
  composite: {
    create: (payload) => ipcRenderer.invoke('composite:create', payload),
    rebake: (payload) => ipcRenderer.invoke('composite:rebake', payload)
  }
}

contextBridge.exposeInMainWorld('noctivago', api)
