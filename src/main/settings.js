import Store from 'electron-store'

const store = new Store({
  name: 'settings',
  defaults: {
    autoUpdateEnabled: true,
    autoInstallUpdates: false,
    minimizeToTrayEnabled: false,
    wasPlayingOnClose: false
  }
})

export function getSettings() {
  return {
    autoUpdateEnabled: store.get('autoUpdateEnabled'),
    autoInstallUpdates: store.get('autoInstallUpdates'),
    minimizeToTrayEnabled: store.get('minimizeToTrayEnabled'),
    wasPlayingOnClose: store.get('wasPlayingOnClose')
  }
}

export function setAutoUpdateEnabled(enabled) {
  store.set('autoUpdateEnabled', Boolean(enabled))
  return getSettings()
}

// When on, a detected update skips the "Download?" confirmation entirely -
// downloads, installs, and restarts with zero prompts. install-and-restart
// itself was already silent/single-confirmation (see autoUpdate.js); this
// setting is what removes the one remaining prompt in front of that.
export function setAutoInstallUpdatesEnabled(enabled) {
  store.set('autoInstallUpdates', Boolean(enabled))
  return getSettings()
}

export function setMinimizeToTrayEnabled(enabled) {
  store.set('minimizeToTrayEnabled', Boolean(enabled))
  return getSettings()
}

// Tracks whether *anything* was actively playing the last time the Mixer's
// play state changed - not written at quit time (no reliable synchronous
// main<->renderer round-trip at that exact moment), just kept current on
// every play/pause transition, so whatever it says when the app actually
// closes is already correct.
export function setWasPlayingOnClose(wasPlaying) {
  store.set('wasPlayingOnClose', Boolean(wasPlaying))
  return getSettings()
}
