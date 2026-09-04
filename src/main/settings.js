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
    // When on, the Export pipeline (src/main/ffmpeg/exportMix.js) renders its
    // independent short passes several at a time instead of one after another,
    // and uses rubberband's faster (slightly lower quality) pitch mode - a
    // real speed win on a long/dense export at the cost of pinning multiple
    // CPU cores and spiking RAM. Off by default: the pipeline has a documented
    // history of a "took all my RAM and never finished" bug, so the
    // higher-resource path is strictly opt-in and hard-capped.
    fasterExport: false,
    // Export Part B (2026-09-02 owner ask, a second/separate opt-in toggle
    // from fasterExport above): when on, exportMix.js's final mixdown tiles
    // each loop-mode sound to its own full-duration track as an independent
    // ffmpeg process, several at once, instead of every loop sound sharing
    // one single-threaded final pass - see exportMix.js's own doc comment
    // for why this beats literal time-chunking (targets the real bottleneck,
    // zero seam risk). Off by default: real correctness/resource trade-offs
    // (extra temp disk I/O for the per-sound tiles, same CPU/RAM profile as
    // fasterExport) the owner explicitly accepted as opt-in only.
    parallelMixdown: false,
    // Legacy v0.1.136 boolean, superseded by exportVideoMode below (v0.1.139)
    // - kept only so resolveExportVideoMode() has something to migrate an
    // existing "on" choice from on first read after the upgrade. Never read
    // directly anywhere else; don't reintroduce a live use of this key.
    blackVideoExport: false,
    // Export tab: whether a run writes the standalone audio file, the
    // black-screen .mkv video (audio muxed under a looped flat 1080p frame,
    // for YouTube), or both. 'video-only' still renders the audio internally
    // (ffmpeg needs it to mux) but deletes the standalone file once the video
    // exists - see exportMix.js's own handling. null is the "never chosen
    // yet" sentinel resolveExportVideoMode() migrates away from; getSettings()
    // never returns null for this field.
    exportVideoMode: null,
    // Export tab (v0.1.140): also write a plain-text info.txt next to the
    // export - preset name, length, format, output type, and each included
    // sound's name + tags - meant as raw material for writing a YouTube/
    // social description by hand or with an AI's help. Off by default like
    // every other opt-in Export addition in this app's history (fasterExport,
    // parallelMixdown, the old blackVideoExport) - a small file, but still an
    // extra artifact the owner didn't ask to always get.
    exportInfoFile: false,
    // "Add from link" (v0.1.121) already handles a plain direct audio URL
    // via ffmpeg's own http client; when that fails (e.g. a YouTube watch
    // page, not a raw media file), library.js falls back to yt-dlp - see
    // addSoundFromUrl. YouTube's current bot-detection ("Sign in to confirm
    // you're not a bot") blocks yt-dlp's anonymous extraction outright, so
    // this setting picks which browser's cookies yt-dlp should read
    // (--cookies-from-browser) to authenticate as a real signed-in session.
    // 'none' = no cookies passed (works for sites without bot-detection,
    // fails on YouTube specifically). Off/none by default - reading another
    // app's cookie store is a real capability, opt-in only.
    ytDlpCookiesBrowser: 'none',
    // Remembered so a nightly-use sleep timer doesn't need re-picking every
    // time - just the last chosen values, not an active timer (that's
    // session-only, main-process state in sleepTimer.js).
    sleepTimerMinutes: 30,
    sleepTimerAction: 'stop', // 'stop' | 'sleep' | 'shutdown'
    // The app version the last time it ran - compared against the current
    // version on startup to detect "we just updated" and show the What's-new
    // screen (see autoUpdate.js). null on a first-ever launch, which
    // correctly shows nothing.
    lastRunVersion: null,
    // Remembered parent folder for the Export tab's destination picker
    // (v0.1.138) - the picker moved from a single-file save dialog to a
    // pick-a-folder dialog (each export now gets its own subfolder named
    // after the preset, see ipc.js's export:pickDestination), and unlike a
    // save dialog the OS doesn't remember that folder on its own, so this
    // mirrors library.js's lastAddFolder pattern instead.
    lastExportFolder: null
  }
})

const EXPORT_VIDEO_MODES = ['audio-only', 'video-only', 'both']

// One-time migration off the old blackVideoExport boolean (v0.1.136) the
// first time settings are read after upgrading to v0.1.139 - "on" becomes
// 'both' (closest match to the old behavior: audio + video), "off"/never-set
// becomes the new default 'audio-only'. Persists the result so this only
// ever runs once per install.
function resolveExportVideoMode() {
  const current = store.get('exportVideoMode')
  if (EXPORT_VIDEO_MODES.includes(current)) return current
  const migrated = store.get('blackVideoExport') ? 'both' : 'audio-only'
  store.set('exportVideoMode', migrated)
  return migrated
}

export function getSettings() {
  return {
    autoUpdateEnabled: store.get('autoUpdateEnabled'),
    autoUpdateIntervalSeconds: store.get('autoUpdateIntervalSeconds'),
    autoInstallUpdates: store.get('autoInstallUpdates'),
    minimizeToTrayEnabled: store.get('minimizeToTrayEnabled'),
    wasPlayingOnClose: store.get('wasPlayingOnClose'),
    eagerlyBakeOnImport: store.get('eagerlyBakeOnImport'),
    skipRemixLeaveConfirm: store.get('skipRemixLeaveConfirm'),
    fasterExport: store.get('fasterExport'),
    parallelMixdown: store.get('parallelMixdown'),
    exportVideoMode: resolveExportVideoMode(),
    exportInfoFile: store.get('exportInfoFile'),
    ytDlpCookiesBrowser: store.get('ytDlpCookiesBrowser'),
    sleepTimerMinutes: store.get('sleepTimerMinutes'),
    sleepTimerAction: store.get('sleepTimerAction'),
    lastRunVersion: store.get('lastRunVersion'),
    lastExportFolder: store.get('lastExportFolder')
  }
}

export function setLastRunVersion(version) {
  store.set('lastRunVersion', version)
  return getSettings()
}

export function setLastExportFolder(folderPath) {
  store.set('lastExportFolder', folderPath)
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

export function setFasterExportEnabled(enabled) {
  store.set('fasterExport', Boolean(enabled))
  return getSettings()
}

export function setParallelMixdownEnabled(enabled) {
  store.set('parallelMixdown', Boolean(enabled))
  return getSettings()
}

export function setExportVideoMode(mode) {
  store.set('exportVideoMode', EXPORT_VIDEO_MODES.includes(mode) ? mode : 'audio-only')
  return getSettings()
}

export function setExportInfoFileEnabled(enabled) {
  store.set('exportInfoFile', Boolean(enabled))
  return getSettings()
}

const YT_DLP_COOKIE_BROWSERS = ['none', 'chrome', 'edge', 'firefox', 'brave']
export function setYtDlpCookiesBrowser(browser) {
  store.set('ytDlpCookiesBrowser', YT_DLP_COOKIE_BROWSERS.includes(browser) ? browser : 'none')
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
