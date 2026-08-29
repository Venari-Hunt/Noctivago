import Store from 'electron-store'

// Matches autoUpdate.js's original hardcoded RECHECK_INTERVAL_MS (4 hours) -
// now the default rather than the only option, per a direct request for a
// configurable hh:mm:ss field in Settings.
const DEFAULT_AUTO_UPDATE_INTERVAL_SECONDS = 4 * 60 * 60

const store = new Store({
  name: 'settings',
  defaults: {
    autoUpdateEnabled: true,
    autoUpdateIntervalSeconds: DEFAULT_AUTO_UPDATE_INTERVAL_SECONDS,
    autoInstallUpdates: false,
    minimizeToTrayEnabled: false,
    wasPlayingOnClose: false,
    eagerlyBakeOnImport: false,
    skipRemixLeaveConfirm: false,
    // Remembered so a nightly-use sleep timer doesn't need re-picking every
    // time - just the last chosen values, not an active timer (that's
    // session-only, main-process state in sleepTimer.js).
    sleepTimerMinutes: 30,
    sleepTimerAction: 'stop', // 'stop' | 'sleep' | 'shutdown'
    // The app version the last time it ran - compared against the current
    // version on startup to detect "we just updated" and show the What's-new
    // screen (see autoUpdate.js). null on a first-ever launch, which
    // correctly shows nothing.
    lastRunVersion: null
  }
})

export function getSettings() {
  return {
    autoUpdateEnabled: store.get('autoUpdateEnabled'),
    autoUpdateIntervalSeconds: store.get('autoUpdateIntervalSeconds'),
    autoInstallUpdates: store.get('autoInstallUpdates'),
    minimizeToTrayEnabled: store.get('minimizeToTrayEnabled'),
    wasPlayingOnClose: store.get('wasPlayingOnClose'),
    eagerlyBakeOnImport: store.get('eagerlyBakeOnImport'),
    skipRemixLeaveConfirm: store.get('skipRemixLeaveConfirm'),
    sleepTimerMinutes: store.get('sleepTimerMinutes'),
    sleepTimerAction: store.get('sleepTimerAction'),
    lastRunVersion: store.get('lastRunVersion')
  }
}

export function setLastRunVersion(version) {
  store.set('lastRunVersion', version)
  return getSettings()
}

export function setSleepTimerPrefs({ minutes, action }) {
  if (Number.isFinite(minutes) && minutes > 0) store.set('sleepTimerMinutes', Math.round(minutes))
  if (['stop', 'sleep', 'shutdown'].includes(action)) store.set('sleepTimerAction', action)
  return getSettings()
}

export function setAutoUpdateEnabled(enabled) {
  store.set('autoUpdateEnabled', Boolean(enabled))
  return getSettings()
}

// Clamped to a sane minimum (1 minute) so a mistyped/near-zero value can't
// hammer the update endpoint - the field itself doesn't enforce this, only
// the persisted value does.
export function setAutoUpdateIntervalSeconds(seconds) {
  store.set('autoUpdateIntervalSeconds', Math.max(60, Math.round(seconds)))
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

// Set from the Remix plugin's own leave-confirmation prompt's "Don't ask
// again" button (Ctrl+Z/Redo/Cancel/leave-prompt feature) - once on, leaving
// Remix with unsaved changes no longer prompts, it just discards them
// silently the way it always would have if the user clicked "Yes."
export function setSkipRemixLeaveConfirmEnabled(enabled) {
  store.set('skipRemixLeaveConfirm', Boolean(enabled))
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
