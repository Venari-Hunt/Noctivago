import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // app.isPackaged is a main-process-only property - preload can't reach it
  // directly through a plain `electron` import (that surface only exposes
  // ipcRenderer/contextBridge/etc. here), so this goes through IPC instead.
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoUpdateEnabled', enabled),
    setAutoInstallUpdatesEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoInstallUpdatesEnabled', enabled),
    setMinimizeToTrayEnabled: (enabled) => ipcRenderer.invoke('settings:setMinimizeToTrayEnabled', enabled),
    setWasPlayingOnClose: (wasPlaying) => ipcRenderer.invoke('settings:setWasPlayingOnClose', wasPlaying)
  },
  autoUpdate: {
    checkNow: () => ipcRenderer.invoke('autoUpdate:checkNow')
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
    addFolderSounds: (folderPath, options) => ipcRenderer.invoke('library:addFolderSounds', folderPath, options),
    updateMeta: (id, meta) => ipcRenderer.invoke('library:updateMeta', id, meta),
    updateLoopPoints: (id, points) => ipcRenderer.invoke('library:updateLoopPoints', id, points),
    updateFilters: (id, filters) => ipcRenderer.invoke('library:updateFilters', id, filters),
    updateVolume: (id, volume) => ipcRenderer.invoke('library:updateVolume', id, volume),
    updateIncluded: (id, included) => ipcRenderer.invoke('library:updateIncluded', id, included),
    updateCrossfade: (id, crossfadeSeconds) => ipcRenderer.invoke('library:updateCrossfade', id, crossfadeSeconds),
    updateTags: (id, tags) => ipcRenderer.invoke('library:updateTags', id, tags),
    reorderSounds: (orderedIds) => ipcRenderer.invoke('library:reorderSounds', orderedIds),
    rename: (id, name) => ipcRenderer.invoke('library:rename', id, name),
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
    delete: (id) => ipcRenderer.invoke('presets:delete', id)
  },
  audio: {
    renderLoopClip: (id, points) => ipcRenderer.invoke('audio:renderLoopClip', id, points),
    getWaveformPeaks: (id, targetWidth) => ipcRenderer.invoke('audio:getWaveformPeaks', id, targetWidth)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    invoke: (pluginId, method, ...args) => ipcRenderer.invoke('plugin:invoke', pluginId, method, args)
  }
}

contextBridge.exposeInMainWorld('noctivago', api)
