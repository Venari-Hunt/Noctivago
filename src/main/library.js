import { app, dialog } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getLoopClipPath, deleteLoopClip, renderLoopClip, probeDurationSeconds } from './ffmpeg/loopClip.js'
import { runFfmpegToFile } from './ffmpeg/runFfmpeg.js'
import { resolveFfmpegPath } from './ffmpeg/ffmpegPath.js'
import { runYtDlp } from './ytdlp/runYtDlp.js'
import { isYtDlpAvailable } from './ytdlp/ytDlpPath.js'
import { downloadPreviewToWav } from './freesound/download.js'
import { getSettings } from './settings.js'
import { tagsForWatchedFile } from './watchFolderTags.js'
import { MAX_BUFFER_CLIP_SECONDS, DEFAULT_SOUND_VOLUME, applySoundOverride } from '../shared/constants.js'

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
// highpassHz/lowpassHz/gainDb/gateThresholdDb.../echoDelayMs/echoDecay) rather than a new
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

// Volume envelope (per-sound, Remix Sound mode, Loop mode only) - drag
// control points directly on the waveform to shape volume over time instead
// of one flat level (Audacity's classic envelope tool). Folded into the
// existing `filters` bag (not a new top-level field, unlike Fluctuation)
// specifically *because* it's deterministic and bakeable - it gets rendered
// straight into the loop clip's own WAV (src/main/ffmpeg/volumeEnvelope.js),
// so it needs the exact same plumbing every other filter already has: the
// per-preset override system (`filters` is one of OVERRIDABLE_SOUND_KEYS),
// the loopClipFilters JSON staleness compare (buffer-mode bake eligibility),
// portable-preset export/import, and the Mixer's bulk-apply-preset flow -
// all already whole-object-replace `filters`, so nesting here needs zero new
// schema/IPC/staleness code, same reasoning the EQ/Gate/Denoise additions
// before it used.
// `position` is a 0..1 FRACTION of the loop region, not absolute seconds -
// this means points never need re-normalizing when loopStart/loopEnd change
// later, the envelope always spans exactly the current loop region
// proportionally. `gain` is a 0..1 multiplier (attenuation only, never
// boosts) - same "never distorts" ceiling Fluctuation's own volume axis
// already uses, since nothing downstream of a per-sound gain node has a
// limiter (only the whole-mix bus does). The two boundary points (position
// 0 and 1) always exist at gain 1.0 (neutral) by default - a flat, inert
// line until the user actually drags something.
export function defaultVolumeEnvelope() {
  return {
    enabled: false,
    points: [
      { position: 0, gain: 1 },
      { position: 1, gain: 1 }
    ]
  }
}

// The Remix "Fluctuation" feature (v0.1.164) - slow, organic drift of a
// looping sound's volume and/or pitch (wind gusts, rain swelling and
// fading). Its own top-level entry field rather than folded into `filters`,
// because unlike every filter it's never baked into the loop clip - it's a
// playback-time behavior applied live by the Source classes (same category
// as crossfadeSeconds / scatter / schedule). Both axes disabled by default,
// so a fresh sound behaves exactly as before until the user turns one on.
// volume: a 0..1 multiplier that rides *below* the sound's set level
// (attenuation only - never boosts, so it can't push a hot sound into
// clipping). pitch: a semitone offset. changeMinSeconds/changeMaxSeconds
// (random gap between target picks) and transitionSeconds (glide time) are
// flat seconds the user sets directly (v0.1.176 - was a 0..1 percentage);
// fullyRandom bypasses min/bias/max and roams the whole axis. Pre-v0.1.176
// saves with changeRate/transition are migrated in normalizeFluctuationAxis
// (src/renderer/audio/Modulator.js).
export function defaultFluctuation() {
  return {
    volume: { enabled: false, fullyRandom: false, min: 0.5, max: 1, bias: 0.8, changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 },
    pitch: { enabled: false, fullyRandom: false, min: -1, max: 1, bias: 0, changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 }
  }
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

// `tags` (v0.1.198, "watch-folder subfolders as tags"): applied after the
// import itself, mirroring the existing manual "Add folder as tag" dialog's
// own two-step shape (import, then a separate updateTags call) rather than
// threading tags through addSound - the only caller that ever has tags to
// apply at import time is a watched folder's own subfolder structure (see
// scanWatchedFolder/watchFolders.js below); every other import path already
// passes nothing and is unaffected.
export function importIfNew(filePath, keepCopy, tags = []) {
  if (!AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) return null
  if (hasSoundForPath(filePath)) return null
  const sound = addSound({ path: filePath, name: path.parse(filePath).name, keepCopy })
  return tags.length > 0 ? updateTags(sound.id, tags) : sound
}

// Recursive (v0.1.198 - was non-recursive, matching addFolderSounds' own
// flat convention, until the owner asked for watched folders specifically
// to walk subfolders too and use them as tags). `recursive: true` on
// readdirSync (Node 20.12+) walks the whole subtree in one call; each
// Dirent's own `parentPath` (the absolute directory actually containing it,
// however deep) is what tagsForWatchedFile compares back against the watch
// root - readdirSync itself doesn't expose depth any other way once results
// come back flattened like this. Used both for the initial scan when a
// folder starts being watched and, via watchFolders.js's startWatching(),
// as a scan-on-startup so files dropped in while the app was closed (at any
// depth) are still picked up (fs.watch only reports changes while it's
// actively running).
export function scanWatchedFolder(entry) {
  if (!fs.existsSync(entry.path)) return []
  const dirents = fs.readdirSync(entry.path, { withFileTypes: true, recursive: true })
  const added = []
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue
    const containingDir = dirent.parentPath
    const filePath = path.join(containingDir, dirent.name)
    const sound = importIfNew(filePath, entry.keepCopy, tagsForWatchedFile(entry.path, containingDir))
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

export function addSound({ path: sourcePath, name, keepCopy, source = null }) {
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
    volume: DEFAULT_SOUND_VOLUME,
    included: false,
    loopStart: 0,
    loopEnd: null,
    filters: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, gateThresholdDb: -80, gateRangeDb: 0, gateAttackMs: 10, gateReleaseMs: 150, denoiseEnabled: false, denoiseStrengthDb: 12, denoiseSampleStartSec: 0, denoiseSampleEndSec: 0, echoDelayMs: 0, echoDecay: 0, reverbSizeMs: 0, reverbMix: 0, eq: defaultEqBands(), volumeEnvelope: defaultVolumeEnvelope() },
    crossfadeSeconds: null,
    fluctuation: defaultFluctuation(),
    // dopplerEnabled: a simulated vehicle/siren pass-by - pitch bends
    // smoothly upward approaching the "closest" point (dopplerClosestFraction,
    // 0-1 across the loop region, shown as a draggable marker on the Remix
    // waveform and defaulting to the midpoint), crosses back to natural
    // pitch exactly there, then bends downward toward Start/End (both
    // "furthest"). Dragging the marker off-center makes the two sides ramp
    // at different rates - closer to Start means a faster approach and
    // slower recession, or vice versa. dopplerIntensitySemitones (default 5,
    // replacing what used to be a fixed constant) sets how far the swing
    // reaches. dopplerReversed flips the whole shape: instead of the marker
    // being the natural-pitch crossing and Start/End being the extremes, the
    // marker becomes the extreme (a sharp close pass-by) and Start/End
    // become natural pitch - modeling something darting very close then
    // away, rather than approaching from and receding into the distance.
    // dopplerSharpness (0..1, default 0.5) sets how abruptly the pitch swings
    // through the marker: low = a slow glide across the whole clip, high =
    // flat plateaus with a fast burst at the marker (the actual pass-by
    // sound). The contour follows the physical Doppler model rather than a
    // straight semitone ramp - see loopClip.js's buildDopplerSendCmd. Bake-
    // only, like Reverse - no live preview.
    speedPitch: {
      speed: 1,
      pitchSemitones: 0,
      reversed: false,
      dopplerEnabled: false,
      dopplerClosestFraction: 0.5,
      dopplerIntensitySemitones: 5,
      dopplerReversed: false,
      dopplerSharpness: 0.5
    },
    // playMode 'scatter': instead of looping continuously, replay the
    // trimmed clip at a random gap (minGapSeconds-maxGapSeconds of silence
    // between repeats, or 0..2min if gapFullyRandom) with a random pitch shift
    // each time (minPitchSemitones-maxPitchSemitones, or the whole ±12 st
    // range if pitchFullyRandom - the two *FullyRandom flags are explicit
    // toggles in the Remix scatter controls; before v0.1.105, leaving both
    // pitch bounds at 0 was a hidden trigger for fully-random pitch, which the
    // owner asked to make 0/0 mean literally "no variation" instead), a random
    // volume scale each time (minVolume-maxVolume, both at
    // 1 means "always full volume" - unlike pitch, 0 isn't a neutral value
    // for volume, so there's no equivalent "both 0" special case here), and
    // an optional fade-in/fade-out envelope per shot (fadeInMs/fadeOutMs,
    // both 0 by default = today's hard on/off) - see plugins/editor/index.js's
    // Playback Mode section, the only place this gets edited. Purely a
    // playback-time schedule, never baked into the clip itself - see
    // effectiveCrossfadeSeconds below for the one thing about scatter mode
    // that *does* affect baking.
    // playMode 'scheduled': instead of looping or scattering, replay the
    // trimmed clip once at each real-world wall-clock trigger (a church bell
    // at 12:00/00:00, an hourly chime) - schedule.type 'times' lists one or
    // more daily HH:MM (24h) triggers, 'interval' fires every
    // intervalMinutes, aligned to midnight (60 => on the hour, 30 => on the
    // hour and half-hour, "like a digital clock" rather than counting from
    // whenever the app happened to start). Deliberately no randomization
    // (pitch/volume/fade) unlike scatter - the point is a deterministic cue
    // at a known time. See plugins/editor/index.js's Playback Mode section,
    // the only place this gets edited, and
    // src/renderer/audio/ScheduledSoundSource.js for the playback engine.
    playMode: 'loop',
    scatter: {
      minGapSeconds: 5,
      maxGapSeconds: 35,
      gapFullyRandom: false,
      // "Bias" (owner inbox 2026-09-14): min/max stay the hard range for the
      // random pick, but when enabled a bias value wins more often than a
      // plain uniform draw - off by default, same explicit-opt-in shape as
      // gapFullyRandom/pitchFullyRandom themselves. See ScatterSoundSource.js's
      // randomGapSeconds/randomPitchSemitones for the actual pick.
      gapBiasEnabled: false,
      gapBiasSeconds: 20,
      minPitchSemitones: 0,
      maxPitchSemitones: 0,
      pitchFullyRandom: false,
      pitchBiasEnabled: false,
      pitchBiasSemitones: 0,
      minVolume: 1,
      maxVolume: 1,
      // Per-shot wall-clock playback speed range, as a multiplier (1 = original
      // tempo). Both at 1 (default) = no speed variation. Pitch-preserved: the
      // shot clip is time-stretched, so the shot just gets shorter/longer, not
      // higher/lower - same behavior as the Remix "Speed" control. See
      // ScatterSoundSource.js's randomSpeedFactor.
      minSpeed: 1,
      maxSpeed: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      // Two or more scatter sounds sharing a non-empty, case-sensitive group
      // name always fire together ("Sync it up with" - one starts, all
      // start): whenever any member fires a shot (natural gap-elapsed cycle
      // or an explicit test-fire), every other currently-included member of
      // the same group fires immediately too, resetting its own gap cycle
      // from that shared moment. Empty string (the default) means "not
      // synced" - a free-text field rather than a picker, so any number of
      // sounds can join a group just by typing the same name, no separate
      // membership UI needed. See tabs/mixer/index.js's propagateSync and
      // ScatterSoundSource.js's onShotStart hook for the playback mechanism.
      syncGroup: ''
    },
    schedule: {
      type: 'times',
      times: [],
      intervalMinutes: 60,
      // Per direct owner request: a scheduled shot's own character - pitch,
      // volume, fade in/out - gets the exact same controls a scatter shot
      // already has (only the *timing* stays deterministic clock math,
      // unlike scatter's random gap). Same field names/defaults as
      // entry.scatter's own copies, reused directly rather than reinvented.
      minPitchSemitones: 0,
      maxPitchSemitones: 0,
      pitchFullyRandom: false,
      pitchBiasEnabled: false,
      pitchBiasSemitones: 0,
      minVolume: 1,
      maxVolume: 1,
      minSpeed: 1,
      maxSpeed: 1,
      fadeInMs: 0,
      fadeOutMs: 0
    },
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
    // Attribution metadata for an import that isn't just a local file - only
    // Freesound sets this today (see addSoundFromFreesound below), null for
    // every other import path. Shown as a badge in the Mixer (SoundRow.js)
    // since a CC-BY sound legally needs its author/license kept visible, not
    // just imported silently.
    source,
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

// Record-from-microphone import: the renderer captures via MediaRecorder
// (webm/opus, the only format Chromium's MediaRecorder actually produces)
// and sends the raw bytes over IPC - written to a scratch .webm here, then
// transcoded to .wav via ffmpeg (the same bundled binary every other
// ffmpeg-based feature already uses) before going through the *exact* same
// addSound(keepCopy: true) path any other imported file does. Mirrors the
// Composite plugin's own render-to-tmp-then-addSound-then-cleanup shape
// exactly (see ipc.js's composite:create) - once a real .wav file exists on
// disk, this is a completely normal import, no new playback/schema code
// needed anywhere else in the app.
export async function addRecordedSound({ name, buffer }) {
  const tmpDir = path.join(app.getPath('userData'), 'recording-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const id = crypto.randomUUID()
  const webmPath = path.join(tmpDir, `${id}.webm`)
  const wavPath = path.join(tmpDir, `${id}.wav`)
  fs.writeFileSync(webmPath, Buffer.from(buffer))
  try {
    await runFfmpegToFile(['-y', '-i', webmPath, wavPath])
    return addSound({ path: wavPath, name, keepCopy: true })
  } finally {
    try {
      if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath)
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)
    } catch {
      // best-effort cleanup, same as composite:create's own tmp-file handling
    }
  }
}

// Download-from-a-direct-link import (owner's own backlog steer answer,
// 2026-09-01: "ffmpeg also downloads stuff from links... get a hold of some
// infrastructure to download an audio and using it on the app"). Same shape
// as addRecordedSound right above - ffmpeg reads the URL directly (its own
// http/https client, confirmed compiled into the bundled binary via
// `-protocols` before writing this) and transcodes straight to a scratch
// .wav, which then goes through the exact same addSound(keepCopy: true)
// path any other imported file does. `-rw_timeout` (microseconds) bounds how
// long a stalled/dead connection can hang the app on - confirmed accepted by
// the real bundled binary (an unsupported option would fail every download
// outright, so this was checked directly rather than assumed). `-vn` drops
// any video stream a mistakenly-pasted video-with-audio link might have,
// keeping just the audio - same reasoning as the recording path not needing
// one (its own input is always audio-only).
//
// Originally distinct from the parked YouTube/yt-dlp idea: this only ever
// touched a plain HTTP(S) URL pointing straight at a raw media file, not a
// scraper for a specific platform's page. The owner later asked directly for
// the video-site case too ("the audio downloads should work for youtube and
// for whatever this can be done to... do it") - rather than a second,
// separate UI entry, this same function now falls back to yt-dlp
// (downloadViaYtDlp below) whenever the direct ffmpeg attempt fails, since a
// YouTube/Vimeo/etc. watch-page URL isn't itself a media file and ffmpeg's
// own -i on it fails immediately. A plain direct-audio-link URL never
// reaches the fallback at all - zero added latency/risk to the already-
// shipped v0.1.121 behavior.
const DOWNLOAD_RW_TIMEOUT_MICROSECONDS = 30_000_000 // 30s

async function downloadDirectAudio(parsed, { maxSeconds = 0, onProgress } = {}) {
  const tmpDir = path.join(app.getPath('userData'), 'download-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const wavPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`)
  const args = ['-y', '-rw_timeout', String(DOWNLOAD_RW_TIMEOUT_MICROSECONDS), '-i', parsed.toString(), '-vn']
  // -t as an output option stops muxing (and pulling the input stream) at
  // maxSeconds - so a link to a 10-hour stream only pulls the first N minutes.
  if (maxSeconds > 0) args.push('-t', String(maxSeconds))
  args.push(wavPath)
  await runFfmpegToFile(args, {
    onProgress:
      maxSeconds > 0 && onProgress
        ? (sec) => onProgress({ type: 'progress', percent: Math.max(0, Math.min(100, (sec / maxSeconds) * 100)) })
        : undefined
  })
  return wavPath
}

// yt-dlp downloads + extracts to a %(ext)s-templated name (its own
// post-processing decides the real final extension after -x --audio-format
// wav runs, so a literal fixed "<id>.wav" -o target isn't reliable) - the
// resulting file is found afterward by its own id prefix rather than
// assumed. --ffmpeg-location points yt-dlp at this app's own bundled ffmpeg
// binary instead of requiring a second copy. --cookies-from-browser is only
// passed when the owner has opted into a specific browser in Settings -
// YouTube's current bot-detection otherwise rejects anonymous extraction
// outright ("Sign in to confirm you're not a bot"), confirmed directly
// against the real yt-dlp binary before writing this.
async function downloadViaYtDlp(url, { maxSeconds = 0, onProgress } = {}) {
  const tmpDir = path.join(app.getPath('userData'), 'download-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const id = crypto.randomUUID()
  const outputTemplate = path.join(tmpDir, `${id}.%(ext)s`)
  const cookiesBrowser = getSettings().ytDlpCookiesBrowser

  const args = ['--no-playlist', '-x', '--audio-format', 'wav', '--ffmpeg-location', resolveFfmpegPath(), '-o', outputTemplate, '--newline']
  // "*0-N" downloads only the first N seconds of the source rather than the
  // whole thing - verified against the real bundled yt-dlp with -x audio
  // extraction before shipping.
  if (maxSeconds > 0) args.push('--download-sections', `*0-${maxSeconds}`)
  if (cookiesBrowser && cookiesBrowser !== 'none') args.push('--cookies-from-browser', cookiesBrowser)
  args.push(url)

  await runYtDlp(args, {
    onProgress: onProgress ? (percent) => onProgress({ type: 'progress', percent }) : undefined,
    onStatus: onProgress ? (message) => onProgress({ type: 'status', message }) : undefined
  })

  const match = fs.readdirSync(tmpDir).find((f) => f.startsWith(id))
  if (!match) throw new Error('yt-dlp reported success but produced no output file.')
  return path.join(tmpDir, match)
}

// onProgress (optional) is fed { type:'step', message } for the coarse
// phase changes, { type:'status', message } for yt-dlp's own verbose lines,
// and { type:'progress', percent } as the download advances - the IPC
// handler forwards each straight to the Add-from-link dialog.
export async function addSoundFromUrl({ name, url, maxSeconds }, onProgress) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('That doesn\'t look like a valid URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are supported.')
  }

  // A safety cap (dialog default 10 min) so a link to a multi-hour stream
  // doesn't pull in full - 0 / blank means "download the whole thing".
  const cap = Number.isFinite(maxSeconds) && maxSeconds > 0 ? Math.round(maxSeconds) : 0
  if (cap > 0) onProgress?.({ type: 'step', message: `Limiting the download to the first ${Math.round(cap / 60)} min.` })

  let wavPath
  let usedYtDlp = false
  try {
    onProgress?.({ type: 'step', message: 'Trying a direct audio download…' })
    wavPath = await downloadDirectAudio(parsed, { maxSeconds: cap, onProgress })
  } catch (directErr) {
    if (!isYtDlpAvailable()) throw directErr
    try {
      onProgress?.({ type: 'step', message: 'Not a direct audio file — handing it to yt-dlp (YouTube / video sites)…' })
      wavPath = await downloadViaYtDlp(parsed.toString(), { maxSeconds: cap, onProgress })
      usedYtDlp = true
    } catch (ytDlpErr) {
      throw new Error(`Couldn't download that link directly (${directErr.message}), and yt-dlp also failed: ${ytDlpErr.message}`)
    }
  }

  try {
    onProgress?.({ type: 'progress', percent: 100 })
    onProgress?.({ type: 'step', message: 'Adding it to your library…' })
    const fallbackName =
      (usedYtDlp ? null : decodeURIComponent(path.basename(parsed.pathname)).replace(/\.[^.]+$/, '')) || 'Downloaded audio'
    return addSound({ path: wavPath, name: name || fallbackName, keepCopy: true })
  } finally {
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)
    } catch {
      // best-effort cleanup, same as addRecordedSound's own
    }
  }
}

// Freesound import (2026-09-14 backlog item, unblocked once the auth
// question was actually looked up - see CLAUDE.md's own entry). Downloads
// the search result's preview (128kbps mp3, not the full original - see
// src/main/freesound/client.js for why) via the same ffmpeg-to-scratch-wav
// shape addSoundFromUrl above already uses, then funnels through the exact
// same addSound(keepCopy: true) path every other import does. The only new
// thing is `source`, carrying the attribution a CC-BY (or similar) sound
// needs - see SoundRow.js for where it's surfaced.
export async function addSoundFromFreesound({ freesoundId, name, username, license, pageUrl, previewUrl }, onProgress) {
  onProgress?.({ type: 'step', message: 'Downloading preview from Freesound…' })
  const wavPath = await downloadPreviewToWav(previewUrl)
  try {
    onProgress?.({ type: 'step', message: 'Adding it to your library…' })
    return addSound({
      path: wavPath,
      name: name || 'Freesound sound',
      keepCopy: true,
      source: { type: 'freesound', freesoundId, username, license, pageUrl, importedAt: Date.now() }
    })
  } finally {
    try {
      if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath)
    } catch {
      // best-effort cleanup, same as addSoundFromUrl's own
    }
  }
}

// "Save as copy" in the Remix plugin - trims a segment out of a longer
// recording (e.g. one bird call out of a field recording with several) into
// its own independent sound, without touching the source entry's own saved
// trim/filters. Shares the same originalPath/storageMode/storedFileName as
// the source rather than copying the underlying audio file - never a
// problem, since this app never writes to a sound's original file anyway
// (every trim/filter is metadata + a derived clip cache keyed by id, so a
// fresh id naturally gets its own fresh, independent bake slot with zero
// file duplication needed). loopClip* fields reset to "not yet baked" -
// the caller (Remix's saveAsCopy) immediately follows up with its own
// update*/renderLoopClip calls using the *current live* trim/filters,
// mirroring exactly how a normal Save persists+bakes, just against this new
// id instead of the currently-open one.
export function duplicateSound(id, { name }) {
  const sounds = store.get('sounds')
  const source = sounds.find((s) => s.id === id)
  if (!source) return null
  const now = Date.now()
  const entry = {
    ...source,
    id: crypto.randomUUID(),
    name,
    included: false,
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    loopClipCrossfadeSeconds: null,
    loopClipSpeedPitch: null,
    tags: [...(source.tags ?? [])],
    dateAdded: now,
    sortIndex: now,
    status: 'ok'
  }
  sounds.push(entry)
  store.set('sounds', sounds)
  return entry
}

// Looks up an existing library entry by its source file path (resolved +
// lowercased, same key hasSoundForPath dedups on) - used by the portable-
// preset import flow so locating a file that's already in the library
// reuses that entry instead of creating a duplicate.
export function findSoundByOriginalPath(filePath) {
  const normalized = normalizePath(filePath)
  return store.get('sounds').find((s) => normalizePath(s.originalPath) === normalized) ?? null
}

// Applies the per-sound settings carried inside a portable preset file
// (src/main/presetPortable.js) onto a freshly-added sound. Only the fields
// a preset actually needs to reproduce a mix - trim, filters/EQ, crossfade,
// speed/pitch/doppler, play mode + its scatter/schedule config, and tags -
// never id/path/storage/derived-clip fields. One updateEntry write rather
// than a chain of individual update* calls. Nothing here triggers a bake;
// the imported sound bakes lazily on first play like any other.
// Exported so presetPortable.js builds its export from exactly what
// applyImportedSettings will read back.
export const IMPORTED_SETTINGS_KEYS = [
  'loopStart',
  'loopEnd',
  'filters',
  'crossfadeSeconds',
  'speedPitch',
  'playMode',
  'scatter',
  'schedule',
  'fluctuation'
]

export function applyImportedSettings(id, settings) {
  if (!settings || typeof settings !== 'object') return null
  const patch = {}
  for (const key of IMPORTED_SETTINGS_KEYS) {
    if (settings[key] !== undefined) patch[key] = settings[key]
  }
  if (Array.isArray(settings.tags)) patch.tags = settings.tags
  if (Object.keys(patch).length === 0) return listSounds().find((s) => s.id === id) ?? null
  return updateEntry(id, patch)
}

// The Composite tab ("compose multiple sounds into one baked file") calls
// this right after library.addSound has created the entry from the freshly-
// rendered composite audio - marks it as composite-derived purely for
// display (a badge) and so the Composite tab can find + re-edit it later.
// Deliberately doesn't touch playback/eligibility/staleness fields at all -
// once baked, this is a completely normal sound, per the owner's own
// framing ("it is in fact a new audio file... the existing infrastructure
// is still valid for it").
export function markAsComposite(id, members) {
  return updateEntry(id, { compositeSource: { members, createdAt: Date.now() } })
}

// Re-editing an existing composite (the Composite tab reopened it, the user
// changed members/timing, re-baked). The caller has already overwritten the
// entry's own real audio file in place (same storedFileName - see
// getPlaybackPathForId) before calling this; this just updates the recipe
// metadata and resets the same "not yet baked" loop-clip fields a fresh
// import would have, since the underlying audio content just changed out
// from under any existing trim.
export function updateComposite(id, { name, members }) {
  return updateEntry(id, {
    name,
    compositeSource: { members, createdAt: Date.now() },
    loopStart: 0,
    loopEnd: null,
    loopClipReady: false,
    loopClipStart: null,
    loopClipEnd: null,
    loopClipFilters: null,
    loopClipCrossfadeSeconds: null,
    loopClipSpeedPitch: null
  })
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

export function updateSchedule(id, schedule) {
  return updateEntry(id, { schedule })
}

// Nullable - null means "use the app default" (see loopClip.js's
// DEFAULT_CROSSFADE_SECONDS), a sound only gets a concrete override once
// the Remix plugin's crossfade slider is actually touched and saved.
export function updateCrossfade(id, crossfadeSeconds) {
  return updateEntry(id, { crossfadeSeconds })
}

// v0.1.164 - see defaultFluctuation above. Its own update path (not folded
// into updateFilters) so saving a fluctuation tweak never marks the baked
// loop clip stale / triggers a re-bake, the way a real filter change does.
export function updateFluctuation(id, fluctuation) {
  return updateEntry(id, { fluctuation })
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
    reversed: speedPitch?.reversed ?? false,
    dopplerEnabled: speedPitch?.dopplerEnabled ?? false,
    dopplerClosestFraction: speedPitch?.dopplerClosestFraction ?? 0.5,
    dopplerIntensitySemitones: speedPitch?.dopplerIntensitySemitones ?? 5,
    dopplerReversed: speedPitch?.dopplerReversed ?? false,
    dopplerSharpness: speedPitch?.dopplerSharpness ?? 0.5
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
// Doppler forces crossfade to 0 for the same reason scatter/scheduled do -
// the auto-crossfade rotation physically reorders the clip's own audio to
// hide the loop seam, which would scramble Doppler's intentional start
// (high pitch) -> midpoint (natural) -> end (low pitch) arc into whatever
// order the rotation happened to leave it in. Caught live, not guessed: a
// real baked Doppler clip measured a scrambled double-hump frequency curve
// instead of the intended monotonic descent, traced to this exact
// interaction, before this guard existed.
function effectiveCrossfadeSeconds(entry) {
  if (entry.playMode === 'scatter' || entry.playMode === 'scheduled' || entry.speedPitch?.dopplerEnabled) return 0
  return entry.crossfadeSeconds
}

// `effectiveOverride` (planned 2026-09-12, "presets as primary context"):
// the active preset's own override for this sound, if any (see
// presets.js's getSoundOverride) - the baked-clip cache/staleness fields
// below live on this one global baseline row (there's still only one
// cached clip per sound id, never one per (preset, sound) - a deliberate
// Phase-1 trade-off), so eligibility must be checked against the
// *effective* (possibly preset-overridden) settings, not raw baseline, or a
// bake made under one preset's context would immediately register as stale
// the moment a different preset (or no preset) is the one asking. Every
// existing caller that omits the second argument keeps today's exact
// baseline-only behavior.
//
// `requireFresh` (BUG FIX, v0.1.197): this function serves two genuinely
// different questions that got conflated. (1) "Is the cached clip still
// valid to silently *substitute* for the real thing" - true for the
// Mixer's own buffer-mode decision and for export deciding whether it can
// skip re-baking (src/main/ipc.js's export:run) - a stale clip must never
// be reused there, since it would silently play/export the wrong audio.
// (2) "Does *a* baked clip exist on disk to literally play, stale or not" -
// what the Remix plugin's "Saved audio" toggle needs (BakedClipPreview.js -
// its own doc comment: "switching to Saved is always 100% truthful to what
// the Mixer will really play" *once fresh*, but v0.1.142 deliberately made
// the toggle sticky/staleness-tolerant so the tool keeps working through an
// edit, showing a "stale" indicator instead of going dead). Both questions
// used to share this one strict check, reached from the exact same
// sound://<id>?variant=clip URL both the Mixer and Remix request - so the
// instant any field diverged from the last bake (essentially any edit,
// unsaved or not yet re-baked), the URL 404'd and the audio element failed
// with a demuxer error, even though the Remix UI still showed the toggle as
// enabled (its own client-side savedPreviewEligible() only checks
// loopClipReady, by design - staleness is meant to be tolerated, not
// disqualifying). Reported directly: "never works as it should... happens
// on every sound, essentially always"; a small edit + re-save "worked"
// only because re-saving re-synced the two sides, not because anything was
// actually fixed. Reproduced live via CDP: loading an already-saved sound
// whose baseline filters had drifted from its last real bake (no edit made
// in this session at all) showed the toggle enabled but its <audio>
// element in DEMUXER_ERROR_COULD_NOT_OPEN / NETWORK_NO_SOURCE, tracing back
// to this exact function returning null. Fixed by splitting the two
// questions apart: `requireFresh: false` (the sound:// protocol handler's
// own call, serving both the Mixer's and Remix's requests) only requires
// the clip to exist; export's direct call (ipc.js) keeps the strict,
// staleness-checked default so a stale clip is still never silently reused
// there. Safe for the Mixer too - it already runs the identical staleness
// comparison itself, client-side, in loopClipEligible() before ever
// choosing to fetch this URL, so relaxing the server-side gate never lets
// the Mixer receive a clip it wouldn't otherwise have asked for.
export function getLoopClipPathForId(id, effectiveOverride = null, { requireFresh = true } = {}) {
  const sounds = store.get('sounds')
  const baseline = sounds.find((s) => s.id === id)
  if (!baseline) return null
  const entry = applySoundOverride(baseline, effectiveOverride)
  const eligible =
    entry.loopClipReady &&
    (!requireFresh ||
      (entry.loopClipStart === entry.loopStart &&
        entry.loopClipEnd === entry.loopEnd &&
        JSON.stringify(entry.loopClipFilters) === JSON.stringify(entry.filters) &&
        entry.loopClipCrossfadeSeconds === effectiveCrossfadeSeconds(entry) &&
        normalizeSpeedPitch(entry.loopClipSpeedPitch) === normalizeSpeedPitch(entry.speedPitch)))
  if (!eligible) return null
  const clipPath = getLoopClipPath(id)
  return fs.existsSync(clipPath) ? clipPath : null
}
