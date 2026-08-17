import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getLoopClipPath, deleteLoopClip, renderLoopClip, probeDurationSeconds } from './ffmpeg/loopClip.js'
import { getSettings } from './settings.js'
import { MAX_BUFFER_CLIP_SECONDS } from '../shared/constants.js'

const store = new Store({
  name: 'library',
  defaults: { sounds: [], lastAddFolder: null, watchedFolders: [] }
})

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'opus']

// This app only ships for Windows (see CLAUDE.md), and NTFS path comparison
// is case-insensitive - lowercasing after path.resolve() is enough to treat
// "C:\Sounds\Rain.mp3" and "c:\sounds\rain.mp3" as the same file for dedup.
function normalizePath(p) {
  return path.resolve(p).toLowerCase()
}

function soundsDir() {
  const dir = path.join(app.getPath('userData'), 'sounds')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// undefined (not null) when unset/stale, since that's what dialog.showOpenDialog's
// defaultPath expects to mean "use the OS default" rather than erroring on a
// missing path.
function getLastAddFolder() {
  const folder = store.get('lastAddFolder')
  return folder && fs.existsSync(folder) ? folder : undefined
}

function setLastAddFolder(folderPath) {
  store.set('lastAddFolder', folderPath)
}

function resolvePlaybackPath(entry) {
  if (entry.storageMode === 'copied') {
    return path.join(soundsDir(), entry.storedFileName)
  }
  return entry.originalPath
}

function checkStatus(entry) {
  return fs.existsSync(resolvePlaybackPath(entry)) ? 'ok' : 'missing'
}

// Six-band parametric EQ, folded into the existing `filters` bag (alongside
// highpassHz/lowpassHz/gainDb/echoDelayMs/echoDecay) rather than a new
// top-level field - reuses every bit of existing filters plumbing (Remix's
// updateFilters, the loopClipFilters staleness comparison, LocalFileSoundSource/
// PreviewSource's live-update paths) with zero new schema/IPC/staleness code.
// Roughly log-spaced defaults across the audible range; gainDb: 0 on every
// band is a true no-op regardless of freqHz/q (matches how every other
// filter control in this app treats 0/neutral as "off"), so a fresh sound's
// EQ has no audible effect until a band is actually moved.
// A fresh (or reset) sound's EQ starts with zero bands - the graph is
// entirely user-managed now (add via the graph's own + button, remove via
// its trash button), not a fixed preset count. Was a hardcoded 7-band array
// (matching the real FL Studio "Fruity Parametric EQ 2" this was modeled
// on) until direct feedback that the fixed set felt "too crowded" - the
// live audio chain (SoundSource.js/PreviewSource.js) and the ffmpeg bake
// (loopClip.js) both already treat `eq` as a variable-length array, so this
// is purely a default-value change, not a schema change. `type` still picks
// one of Web Audio's native BiquadFilterNode types for whatever bands a
// user actually adds - 'off' is a pseudo-type mapped to 'allpass' at the
// audio-node level (see SoundSource.js/PreviewSource.js).
function defaultEqBands() {
  return []
}

// Backfills fields added after some entries already existed (tags, dateAdded,
// dateCreated, sortIndex) - same in-place-refresh-on-read pattern checkStatus
// already uses for `status`, so older libraries pick these up transparently
// on next list() rather than needing a dedicated migration step. dateAdded
// has no real original value to recover for pre-existing entries, so it
// backfills to "now" (the moment they're first seen under the new schema) -
// they'll cluster together by date added until touched individually, which
// is an acceptable one-time approximation for a cosmetic sort key.
export function listSounds() {
  const sounds = store.get('sounds')
  let changed = false
  const refreshed = sounds.map((entry) => {
    const status = checkStatus(entry)
    const patch = {}
    if (status !== entry.status) patch.status = status
    if (entry.tags === undefined) patch.tags = []
    if (entry.dateAdded === undefined) patch.dateAdded = Date.now()
    if (entry.dateCreated === undefined) patch.dateCreated = entry.dateAdded ?? patch.dateAdded
    if (entry.sortIndex === undefined) patch.sortIndex = entry.dateAdded ?? patch.dateAdded
    if (Object.keys(patch).length > 0) changed = true
    return { ...entry, ...patch }
  })
  if (changed) store.set('sounds', refreshed)
  return refreshed
}

export async function pickFile() {
  const result = await dialog.showOpenDialog({
    title: 'Add sound',
    defaultPath: getLastAddFolder(),
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const filePath = result.filePaths[0]
  setLastAddFolder(path.dirname(filePath))
  const stats = fs.statSync(filePath)
  return {
    path: filePath,
    name: path.parse(filePath).name,
    sizeBytes: stats.size
  }
}

export async function pickFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Add folder as preset',
    defaultPath: getLastAddFolder(),
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folderPath = result.filePaths[0]
  setLastAddFolder(folderPath)
  return folderPath
}

export async function pickWatchFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Watch folder',
    defaultPath: getLastAddFolder(),
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folderPath = result.filePaths[0]
  setLastAddFolder(folderPath)
  return folderPath
}

export function listWatchedFolders() {
  const folders = store.get('watchedFolders')
  let changed = false
  const refreshed = folders.map((f) => {
    const status = fs.existsSync(f.path) ? 'ok' : 'missing'
    if (status !== f.status) changed = true
    return { ...f, status }
  })
  if (changed) store.set('watchedFolders', refreshed)
  return refreshed
}

// A file already registered under any storage mode (manually added, or
// picked up by a previous scan of this or another watched folder) is never
// re-imported - compares by resolved/lowercased originalPath, so a "copied"
// entry (whose originalPath still points at the source, even though
// playback reads from the stored copy) still dedups correctly.
function hasSoundForPath(filePath) {
  const normalized = normalizePath(filePath)
  return store.get('sounds').some((s) => normalizePath(s.originalPath) === normalized)
}

export function importIfNew(filePath, keepCopy) {
  if (!AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) return null
  if (hasSoundForPath(filePath)) return null
  return addSound({ path: filePath, name: path.parse(filePath).name, keepCopy })
}

// Non-recursive, matching addFolderSounds' existing convention. Used both
// for the initial scan when a folder starts being watched and, via
// watchFolders.js's startWatching(), as a scan-on-startup so files dropped
// in while the app was closed are still picked up (fs.watch only reports
// changes while it's actively running).
export function scanWatchedFolder(entry) {
  if (!fs.existsSync(entry.path)) return []
  const files = fs
    .readdirSync(entry.path, { withFileTypes: true })
    .map((e) => (e.isFile() ? path.join(entry.path, e.name) : null))
    .filter(Boolean)
  const added = []
  for (const filePath of files) {
    const sound = importIfNew(filePath, entry.keepCopy)
    if (sound) added.push(sound)
  }
  return added
}

export function addWatchedFolder(folderPath, { keepCopy }) {
  const folders = store.get('watchedFolders')
  const normalized = normalizePath(folderPath)
  const existing = folders.find((f) => normalizePath(f.path) === normalized)
  if (existing) return { entry: existing, added: [] }

  const entry = { id: crypto.randomUUID(), path: folderPath, keepCopy: Boolean(keepCopy), status: 'ok' }
  folders.push(entry)
  store.set('watchedFolders', folders)
  const added = scanWatchedFolder(entry)
  return { entry, added }
}

export function removeWatchedFolder(id) {
  const folders = store.get('watchedFolders')
  store.set('watchedFolders', folders.filter((f) => f.id !== id))
}

// Adds every audio file directly inside folderPath (non-recursive) to the
// library via the same addSound() every single-file add goes through.
// Returns the added entries so the caller can build a preset from them -
// this function only touches the library, never presets.js, so it stays
// reusable for a plain "add several files at once" case too if that's ever
// wanted without the preset step.
export function addFolderSounds(folderPath, { keepCopy }) {
  const files = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).slice(1).toLowerCase()))
    .map((entry) => path.join(folderPath, entry.name))

  return files.map((filePath) => addSound({ path: filePath, name: path.parse(filePath).name, keepCopy }))
}

// Opt-in background bake for the eagerlyBakeOnImport setting - kicked off
// fire-and-forget from addSound() below, which every import path (single
// file, folder-as-preset, folder-as-tag, watch-folder auto-import) already
// funnels through, so this needed zero changes at any of those call sites.
// A fresh import has no durationSeconds yet - that's normally only learned
// lazily, the first time a sound actually plays and its <audio> element
// fires loadedmetadata (see tabs/mixer/index.js's getOrCreateSource) - so
// this probes it directly via ffmpeg first (probeDurationSeconds). Re-reads
// the entry fresh after that probe (which can take a moment on a large
// file) rather than trusting the snapshot passed in, in case the user
// edited the sound (e.g. via Remix) while the probe was still in flight.
// Silently does nothing past the MAX_BUFFER_CLIP_SECONDS cap (same
// eligibility every other buffer-mode path enforces) or on any ffmpeg
// failure - this is a pure background convenience, never something an
// import should visibly wait on or fail because of.
const eagerBaking = new Set()

async function maybeEagerBakeOnImport(entry) {
  if (!getSettings().eagerlyBakeOnImport) return
  if (eagerBaking.has(entry.id)) return
  eagerBaking.add(entry.id)
  try {
    const inputPath = resolvePlaybackPath(entry)
    if (!fs.existsSync(inputPath)) return
    const durationSeconds = await probeDurationSeconds(inputPath)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return
    updateMeta(entry.id, { durationSeconds })

    const fresh = store.get('sounds').find((s) => s.id === entry.id)
    if (!fresh || fresh.loopEnd == null) return
    if (fresh.loopEnd - fresh.loopStart > MAX_BUFFER_CLIP_SECONDS) return

    const result = await renderLoopClip({
      id: fresh.id,
      inputPath,
      loopStart: fresh.loopStart,
      loopEnd: fresh.loopEnd,
      filters: fresh.filters,
      crossfadeSeconds: fresh.crossfadeSeconds,
      speedPitch: fresh.speedPitch
    })
    if (result.ok) {
      setLoopClipReady(fresh.id, {
        loopStart: fresh.loopStart,
        loopEnd: fresh.loopEnd,
        filters: fresh.filters,
        crossfadeSeconds: fresh.crossfadeSeconds,
        speedPitch: fresh.speedPitch
      })
    }
  } catch (err) {
    console.error('Eager bake on import failed', entry.id, err)
  } finally {
    eagerBaking.delete(entry.id)
  }
}

export function addSound({ path: sourcePath, name, keepCopy }) {
  const id = crypto.randomUUID()
  const stats = fs.statSync(sourcePath)
  const now = Date.now()

  let storageMode = 'reference'
  let storedFileName = null
  if (keepCopy) {
    storedFileName = `${id}${path.extname(sourcePath)}`
    fs.copyFileSync(sourcePath, path.join(soundsDir(), storedFileName))
    storageMode = 'copied'
  }

  const entry = {
    id,
    name,
    originalPath: sourcePath,
    storageMode,
    storedFileName,
    fileSizeBytes: stats.size,
    durationSeconds: null,
    volume: 0.7,
    included: false,
    loopStart: 0,
    loopEnd: null,
    filters: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0, eq: defaultEqBands() },
    crossfadeSeconds: null,
    speedPitch: { speed: 1, pitchSemitones: 0, reversed: false },
    // playMode 'scatter': instead of looping continuously, replay the
    // trimmed clip at a random gap (minGapSeconds-maxGapSeconds of silence
    // between repeats) with a random pitch shift each time (minPitchSemitones-
    // maxPitchSemitones; both at 0 means "fully random" rather than "no
    // shift" - see plugins/editor/index.js's Playback Mode section, the only
    // place this gets edited). Purely a playback-time schedule, never baked
    // into the clip itself - see effectiveCrossfadeSeconds below for the one
    // thing about scatter mode that *does* affect baking.
    playMode: 'loop',
    scatter: { minGapSeconds: 5, maxGapSeconds: 35, minPitchSemitones: 0, maxPitchSemitones: 0 },
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    loopClipCrossfadeSeconds: null,
    loopClipSpeedPitch: null,
    // tags: user-assignable, free-text. dateCreated reads the *source* file's
    // own filesystem birthtime (stat'd above, before any copy) - falls back
    // to "now" on filesystems/mounts that don't report a real birthtime.
    // sortIndex backs the Mixer's "Custom order" sort mode (see SoundList.js)
    // - starts at insertion order (now), reassigned to clean sequential
    // integers across the whole library whenever the user actually drags to
    // reorder (see reorderSounds below).
    tags: [],
    dateAdded: now,
    dateCreated: stats.birthtimeMs || now,
    sortIndex: now,
    status: 'ok'
  }

  const sounds = store.get('sounds')
  sounds.push(entry)
  store.set('sounds', sounds)
  maybeEagerBakeOnImport(entry)
  return entry
}

function updateEntry(id, patch) {
  const sounds = store.get('sounds')
  const idx = sounds.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sounds[idx] = { ...sounds[idx], ...patch }
  store.set('sounds', sounds)
  return sounds[idx]
}

export function updateMeta(id, { durationSeconds }) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  const patch = { durationSeconds }
  if (entry && entry.loopEnd === null) patch.loopEnd = durationSeconds
  return updateEntry(id, patch)
}

// BUG FIX: per-sound volume was tracked only in the Mixer's in-memory
// state.volumes Map, never persisted at all - every restart silently reset
// every sound back to the 0.7 default, reported directly by the user.
export function updateVolume(id, volume) {
  return updateEntry(id, { volume })
}

// Persists which sounds are currently in the mix, so a restart can rebuild
// it - see mixer/index.js's resume-on-launch logic (gated by
// settings.wasPlayingOnClose, not this alone: a sound can be "included"
// while the whole mix is paused, which shouldn't autoplay anything).
export function updateIncluded(id, included) {
  return updateEntry(id, { included })
}

export function updateLoopPoints(id, { loopStart, loopEnd }) {
  return updateEntry(id, { loopStart, loopEnd })
}

export function updateFilters(id, filters) {
  return updateEntry(id, { filters })
}

export function updateSpeedPitch(id, speedPitch) {
  return updateEntry(id, { speedPitch })
}

export function updatePlayMode(id, playMode) {
  return updateEntry(id, { playMode })
}

export function updateScatterConfig(id, scatter) {
  return updateEntry(id, { scatter })
}

// Nullable - null means "use the app default" (see loopClip.js's
// DEFAULT_CROSSFADE_SECONDS), a sound only gets a concrete override once
// the Remix plugin's crossfade slider is actually touched and saved.
export function updateCrossfade(id, crossfadeSeconds) {
  return updateEntry(id, { crossfadeSeconds })
}

export function updateTags(id, tags) {
  return updateEntry(id, { tags })
}

// Reassigns every sound's sortIndex to its position in orderedIds (which
// must include every sound id currently in the library, not just a visible
// subset - see the Mixer's drag-and-drop handler for how it builds this
// from the full library order, not just what's on screen under an active
// search/tag filter). Sounds not present in orderedIds keep their existing
// sortIndex unchanged, so a stale/partial list can't silently drop entries
// out of the ordering.
export function reorderSounds(orderedIds) {
  const sounds = store.get('sounds')
  const indexById = new Map(orderedIds.map((id, index) => [id, index]))
  const reordered = sounds.map((entry) =>
    indexById.has(entry.id) ? { ...entry, sortIndex: indexById.get(entry.id) } : entry
  )
  store.set('sounds', reordered)
  return reordered
}

export function rename(id, name) {
  const trimmed = name.trim()
  if (!trimmed) return null
  return updateEntry(id, { name: trimmed })
}

export function setLoopClipReady(id, { loopStart, loopEnd, filters, crossfadeSeconds, speedPitch }) {
  return updateEntry(id, {
    loopClipReady: true,
    loopClipStart: loopStart,
    loopClipEnd: loopEnd,
    loopClipFilters: filters,
    loopClipCrossfadeSeconds: crossfadeSeconds ?? null,
    loopClipSpeedPitch: speedPitch ?? null
  })
}

export function setLoopClipStale(id) {
  return updateEntry(id, {
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    loopClipCrossfadeSeconds: null,
    loopClipSpeedPitch: null
  })
}

export async function relink(id) {
  const result = await dialog.showOpenDialog({
    title: 'Locate sound file',
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  deleteLoopClip(id)
  return updateEntry(id, {
    originalPath: result.filePaths[0],
    status: 'ok',
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    loopClipSpeedPitch: null,
    loopClipCrossfadeSeconds: null
  })
}

export function remove(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (entry && entry.storageMode === 'copied' && entry.storedFileName) {
    const filePath = path.join(soundsDir(), entry.storedFileName)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  }
  deleteLoopClip(id)
  store.set('sounds', sounds.filter((s) => s.id !== id))
}

export function getPlaybackPathForId(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (!entry) return null
  const filePath = resolvePlaybackPath(entry)
  return fs.existsSync(filePath) ? filePath : null
}

// Normalizes to plain defaults before comparing, since entry.speedPitch is
// undefined on any sound that predates this field (never backfilled - see
// listSounds' comment on why crossfadeSeconds/speedPitch are left nullable
// rather than migrated like tags/dateAdded were) while loopClipSpeedPitch
// is explicitly null on any bake that predates it - both mean "neutral,"
// but undefined !== null under strict comparison.
function normalizeSpeedPitch(speedPitch) {
  return JSON.stringify({
    speed: speedPitch?.speed ?? 1,
    pitchSemitones: speedPitch?.pitchSemitones ?? 0,
    reversed: speedPitch?.reversed ?? false
  })
}

// Scatter mode (see addSound's playMode/scatter fields) replays the trimmed
// clip as one-shots, never back-to-back - the crossfade+rotation a looped
// clip needs to hide its own wrap point would be actively wrong here (it
// permanently reorders the clip's audio, which only makes sense if the
// clip's end is ever going to reconnect to its own start). Forcing the
// *effective* crossfade to 0 for a scatter-mode sound reuses renderLoopClip
// unchanged (0 already means "plain trim, no rotation" - see loopClip.js's
// doRender) instead of needing a second bake pipeline, and naturally
// invalidates any existing bake made under the other mode via the same
// loopClipCrossfadeSeconds staleness check every other trim/filter change
// already goes through.
function effectiveCrossfadeSeconds(entry) {
  return entry.playMode === 'scatter' ? 0 : entry.crossfadeSeconds
}

export function getLoopClipPathForId(id) {
  const sounds = store.get('sounds')
  const entry = sounds.find((s) => s.id === id)
  if (!entry) return null
  const eligible =
    entry.loopClipReady &&
    entry.loopClipStart === entry.loopStart &&
    entry.loopClipEnd === entry.loopEnd &&
    JSON.stringify(entry.loopClipFilters) === JSON.stringify(entry.filters) &&
    entry.loopClipCrossfadeSeconds === effectiveCrossfadeSeconds(entry) &&
    normalizeSpeedPitch(entry.loopClipSpeedPitch) === normalizeSpeedPitch(entry.speedPitch)
  if (!eligible) return null
  const clipPath = getLoopClipPath(id)
  return fs.existsSync(clipPath) ? clipPath : null
}
