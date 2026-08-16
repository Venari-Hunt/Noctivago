import Store from 'electron-store'

const store = new Store({
  name: 'settings',
  defaults: {
    autoUpdateEnabled: true,
    autoInstallUpdates: false,
    minimizeToTrayEnabled: false,
    wasPlayingOnClose: false,
    eagerlyBakeOnImport: false
  }
})

export function getSettings() {
  return {
    autoUpdateEnabled: store.get('autoUpdateEnabled'),
    autoInstallUpdates: store.get('autoInstallUpdates'),
    minimizeToTrayEnabled: store.get('minimizeToTrayEnabled'),
    wasPlayingOnClose: store.get('wasPlayingOnClose'),
    eagerlyBakeOnImport: store.get('eagerlyBakeOnImport')
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

// When on, every newly-imported sound (single file, folder-as-preset,
// folder-as-tag, or watch-folder auto-import - all of them funnel through
// library.js's addSound()) gets its seamless-loop clip baked immediately in
// the background, instead of waiting for the sound's first play (the
// existing lazy default - see tabs/mixer/index.js's maybeAutoBake). Purely
// an upfront-convenience opt-in for pre-processing a whole batch at once;
// the lazy default stays the default since eagerly baking every import would
// waste CPU/disk on sounds that might never get played.
export function setEagerlyBakeOnImportEnabled(enabled) {
  store.set('eagerlyBakeOnImport', Boolean(enabled))
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
