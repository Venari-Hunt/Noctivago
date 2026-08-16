import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // app.isPackaged is a main-process-only property - preload can't reach it
  // directly through a plain `electron` import (that surface only exposes
  // ipcRenderer/contextBridge/etc. here), so this goes through IPC instead.
  isPackaged: () => ipcRenderer.invoke('app:isPackaged'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setAutoUpdateEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoUpdateEnabled', enabled)
  },
  autoUpdate: {
    checkNow: () => ipcRenderer.invoke('autoUpdate:checkNow')
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
    rename: (id, name) => ipcRenderer.invoke('library:rename', id, name),
    relink: (id) => ipcRenderer.invoke('library:relink', id),
    remove: (id) => ipcRenderer.invoke('library:remove', id)
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
