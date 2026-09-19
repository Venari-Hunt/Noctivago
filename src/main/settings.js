import Store from 'electron-store'
import { VIZ_FPS_OPTIONS, DEFAULT_VIZ_FPS } from './ffmpeg/visualizationVideo.js'

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
    // Custom AI prompt for the end of info.txt; '' means use the Export
    // plugin's built-in default (DEFAULT_INFO_PROMPT).
    exportInfoPrompt: '',
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
    // time - the last chosen input values.
    sleepTimerMinutes: 30,
    sleepTimerAction: 'stop', // 'stop' | 'displays' | 'sleep' | 'shutdown'
    sleepTimerMode: 'in', // 'in' (a number of minutes) | 'at' (a time of day)
    sleepTimerTimeOfDay: '', // "HH:MM" for the 'at' mode, empty until set
    // A *running* sleep timer, persisted so it survives an app restart /
    // auto-update (owner: "Timer shouldn't be stopped nor lost when you close
    // the app and reopens it"). { firesAt: epoch ms, action } or null.
    // sleepTimer.js re-arms from this on launch; the renderer never reads it
    // directly (it goes through sleepTimer:get like the in-memory one).
    sleepTimerRunState: null,
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
    lastExportFolder: null,
    // Export tab (v0.1.141, Board #next item #4): an optional video file to
    // loop under the audio instead of the flat black screen (see
    // exportMix.js's renderLoopedVideoFromFile). null = the existing
    // black-screen fallback. Persisted like every other Export tab choice so
    // it doesn't need re-picking every export - most owners exporting to the
    // same channel would reuse the same background video repeatedly.
    exportLoopVideoPath: null,
    // Export tab (v0.1.144, the Board's last open Export wishlist item):
    // which of the three video backgrounds drives the video track when
    // exportVideoMode isn't 'audio-only'. null is the "never chosen yet"
    // migration sentinel resolveExportVideoBackground() upgrades once -
    // anyone who'd already picked a loop video via exportLoopVideoPath above
    // keeps using it rather than silently reverting to black.
    exportVideoBackground: null,
    // Visualization sub-options - see src/main/ffmpeg/visualizationVideo.js
    // for how each maps to an ffmpeg filter, and its own doc comment for the
    // real-ffmpeg speed research behind why black is the default bgColor
    // specifically (skips compositing entirely - the owner's own note
    // flagged speed as a hard requirement for this feature).
    exportVisualizationType: 'waveform',
    exportVisualizationColor: '#9ece6a',
    exportVisualizationBgColor: '#000000',
    exportVisualizationPalette: 'intensity',
    exportVisualizationSize: 'medium',
    // Frame rate for the visualization video (v0.1.151 owner follow-up:
    // "leave the option to choose between 15, 30 and 60 fps"). Higher fps
    // looks smoother but costs proportionally more encode time - see
    // visualizationVideo.js's own doc comment for what was actually tried to
    // speed up the encode itself (a libx264 preset change, rejected: real but
    // meaningfully worse file-size trade-off).
    exportVisualizationFps: DEFAULT_VIZ_FPS,
    // Export tab (v0.1.152 inbox item, flagged "veeeery optional... not very
    // crucial"): loop a still image under the export instead of a video/
    // visualization, with an optional spin or "DVD bounce" motion - see
    // src/main/ffmpeg/imageLoopVideo.js. Fade in/out reuses the export's own
    // existing fadeInSeconds/fadeOutSeconds fields rather than a duplicate
    // pair, so no separate fade setting is needed here.
    exportImagePath: null,
    exportImageMotion: 'none',
    // BUG FIX (reported directly, "actively harmful": a restart/autoupdate
    // could bring a quieted-down mix back to full, sharp volume while the
    // owner was asleep). The master (global) volume slider was never
    // persisted at all - every launch silently reset it to the HTML
    // default (50 = unity gain), regardless of what it had been turned down
    // to. 0-100, matches the <input>'s own value attribute (see
    // core/volumeScale.js for the bipolar position->gain mapping). Written
    // debounced on every drag (mirrors per-sound volume's own
    // VOLUME_SAVE_DEBOUNCE_MS pattern in tabs/mixer/index.js).
    globalVolumePosition: 50,
    // Companion fix, same report: which preset (if any) was actively loaded
    // - restored on next launch so a Sound Group's EQ/filters and any
    // whole-mix processing shaping the mix are back in place before
    // playback resumes, instead of every sound silently reverting to raw,
    // unprocessed settings the moment the app restarts.
    lastActivePresetId: null,
    // Owner inbox (2026-09-12): "Autosave should be a toggle on the preset
    // modal" - v0.1.178 made loading a preset then editing the mix (add/
    // remove a sound, drag a volume) autosave back into it with no way to
    // opt out. On by default (preserves that existing behavior); the
    // Presets modal's own checkbox is the only UI for this, not the
    // Settings menu, per the owner's own request for where it should live.
    presetAutosaveEnabled: true,
    // Plugin ids switched off in Settings > Core/Community plugins. Read by
    // plugins/registry.js at launch; changes apply after a restart.
    disabledPlugins: [],
    // Obsidian's Restricted mode: while on, third-party community plugins
    // don't load or install (official ones still do, see
    // shared/pluginEnablement.js).
    restrictedMode: true,
    // Set once the official plugins that used to ship inside the app were
    // downloaded for someone who had them built in (plugins/migration.js).
    pluginSplitMigrated: false,
    // The Mixer's one-time Recommended plugins card was closed.
    recommendedPluginsDismissed: false
  }
})

const EXPORT_VIDEO_MODES = ['audio-only', 'video-only', 'both']
const EXPORT_VIDEO_BACKGROUNDS = ['black', 'file', 'visualization', 'image']
const EXPORT_IMAGE_MOTIONS = ['none', 'spin', 'bounce']
const VISUALIZATION_TYPES = ['waveform', 'spectrum', 'vectorscope']
const VISUALIZATION_PALETTES = ['intensity', 'rainbow', 'fire', 'magma', 'cool', 'moreland']
const VISUALIZATION_SIZES = ['small', 'medium', 'large']
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

// One-time migration mirroring resolveExportVideoMode() just above -
// exportVideoBackground didn't exist before this feature, so an owner who'd
// already picked a loop-video file (exportLoopVideoPath) becomes 'file'
// rather than silently losing that choice to the new 'black' default.
function resolveExportVideoBackground() {
  const current = store.get('exportVideoBackground')
  if (EXPORT_VIDEO_BACKGROUNDS.includes(current)) return current
  const migrated = store.get('exportLoopVideoPath') ? 'file' : 'black'
  store.set('exportVideoBackground', migrated)
  return migrated
}

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
    exportInfoPrompt: store.get('exportInfoPrompt'),
    ytDlpCookiesBrowser: store.get('ytDlpCookiesBrowser'),
    sleepTimerMinutes: store.get('sleepTimerMinutes'),
    sleepTimerAction: store.get('sleepTimerAction'),
    sleepTimerMode: store.get('sleepTimerMode'),
    sleepTimerTimeOfDay: store.get('sleepTimerTimeOfDay'),
    sleepTimerRunState: store.get('sleepTimerRunState'),
    lastRunVersion: store.get('lastRunVersion'),
    lastExportFolder: store.get('lastExportFolder'),
    exportLoopVideoPath: store.get('exportLoopVideoPath'),
    exportVideoBackground: resolveExportVideoBackground(),
    exportVisualizationType: store.get('exportVisualizationType'),
    exportVisualizationColor: store.get('exportVisualizationColor'),
    exportVisualizationBgColor: store.get('exportVisualizationBgColor'),
    exportVisualizationPalette: store.get('exportVisualizationPalette'),
    exportVisualizationSize: store.get('exportVisualizationSize'),
    exportVisualizationFps: store.get('exportVisualizationFps'),
    exportImagePath: store.get('exportImagePath'),
    exportImageMotion: store.get('exportImageMotion'),
    globalVolumePosition: store.get('globalVolumePosition'),
    lastActivePresetId: store.get('lastActivePresetId'),
    presetAutosaveEnabled: store.get('presetAutosaveEnabled'),
    disabledPlugins: store.get('disabledPlugins'),
    restrictedMode: store.get('restrictedMode'),
    pluginSplitMigrated: store.get('pluginSplitMigrated'),
    recommendedPluginsDismissed: store.get('recommendedPluginsDismissed')
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

export function setSleepTimerPrefs({ minutes, action, mode, timeOfDay }) {
  if (Number.isFinite(minutes) && minutes > 0) store.set('sleepTimerMinutes', Math.round(minutes))
  if (['stop', 'displays', 'sleep', 'shutdown'].includes(action)) store.set('sleepTimerAction', action)
  if (mode === 'in' || mode === 'at') store.set('sleepTimerMode', mode)
  if (typeof timeOfDay === 'string' && /^\d{2}:\d{2}$/.test(timeOfDay)) store.set('sleepTimerTimeOfDay', timeOfDay)
  return getSettings()
}

// The one running sleep timer, persisted so a restart / auto-update can
// re-arm it (see sleepTimer.js). Pass null to clear.
export function setSleepTimerRunState(state) {
  if (state && Number.isFinite(state.firesAt) && ['stop', 'displays', 'sleep', 'shutdown'].includes(state.action)) {
    store.set('sleepTimerRunState', { firesAt: state.firesAt, action: state.action })
  } else {
    store.set('sleepTimerRunState', null)
  }
}

export function getSleepTimerRunState() {
  return store.get('sleepTimerRunState') ?? null
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

export function setExportInfoPrompt(prompt) {
  store.set('exportInfoPrompt', typeof prompt === 'string' ? prompt : '')
  return getSettings()
}

// null clears the choice back to the black-screen fallback (see
// exportMix.js). Not validated against fs.existsSync here - a file moved or
// deleted after being chosen surfaces as a normal, non-fatal video-render
// error at export time instead (same "video is a non-fatal companion output"
// philosophy every other Export video failure already follows).
export function setExportLoopVideoPath(filePath) {
  store.set('exportLoopVideoPath', filePath || null)
  return getSettings()
}

export function setExportVideoBackground(mode) {
  store.set('exportVideoBackground', EXPORT_VIDEO_BACKGROUNDS.includes(mode) ? mode : 'black')
  return getSettings()
}

// null clears the choice back to the black-screen fallback, mirroring
// setExportLoopVideoPath's own "no existence check here" reasoning - a moved
// or deleted image surfaces as a normal, non-fatal video-render error at
// export time instead.
export function setExportImagePath(filePath) {
  store.set('exportImagePath', filePath || null)
  return getSettings()
}

export function setExportImageMotion(motion) {
  store.set('exportImageMotion', EXPORT_IMAGE_MOTIONS.includes(motion) ? motion : 'none')
  return getSettings()
}

// Merges whichever visualization fields the caller passed (the Export tab
// sends one field at a time, one per control) - unrecognized/invalid values
// are silently ignored rather than falling back to a default, so one bad
// field in a batch can't stomp the others.
export function setExportVisualizationOptions(options) {
  if (VISUALIZATION_TYPES.includes(options?.type)) store.set('exportVisualizationType', options.type)
  if (HEX_COLOR_RE.test(options?.color)) store.set('exportVisualizationColor', options.color)
  if (HEX_COLOR_RE.test(options?.bgColor)) store.set('exportVisualizationBgColor', options.bgColor)
  if (VISUALIZATION_PALETTES.includes(options?.palette)) store.set('exportVisualizationPalette', options.palette)
  if (VISUALIZATION_SIZES.includes(options?.size)) store.set('exportVisualizationSize', options.size)
  if (VIZ_FPS_OPTIONS.includes(options?.fps)) store.set('exportVisualizationFps', options.fps)
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

export function setGlobalVolumePosition(position) {
  const clamped = Math.round(Math.max(0, Math.min(100, Number(position))))
  if (Number.isFinite(clamped)) store.set('globalVolumePosition', clamped)
  return getSettings()
}

export function setLastActivePresetId(id) {
  store.set('lastActivePresetId', typeof id === 'string' ? id : null)
  return getSettings()
}

export function setPresetAutosaveEnabled(enabled) {
  store.set('presetAutosaveEnabled', Boolean(enabled))
  return getSettings()
}

export function setPluginEnabled(id, enabled) {
  const others = store.get('disabledPlugins').filter((d) => d !== id)
  store.set('disabledPlugins', enabled ? others : [...others, id])
  return getSettings()
}

export function setRestrictedMode(on) {
  store.set('restrictedMode', Boolean(on))
  return getSettings()
}

export function setPluginSplitMigrated() {
  store.set('pluginSplitMigrated', true)
}

export function dismissRecommendedPlugins() {
  store.set('recommendedPluginsDismissed', true)
  return getSettings()
}
