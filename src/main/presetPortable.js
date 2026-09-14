import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as library from './library.js'
import { listPresets, savePreset } from './presets.js'
import { createZip, readZip, looksLikeZip } from './zip.js'

// Portable preset files (.ncvpreset) - a preset plus everything needed to
// reproduce it on another machine.
//
//   formatVersion 1: raw JSON, config only. An imported preset lists any
//                    sound whose file isn't in the library and lets the user
//                    locate it (Phase 1, shipped v0.1.93).
//   formatVersion 2: a ZIP (src/main/zip.js) containing `preset.json` (the
//                    same manifest) plus `audio/<file>` for every sound whose
//                    audio was available at export time - so import can pull
//                    those in automatically (Phase 2).
//
// A local preset is only { soundId, volume } (see presets.js); the per-sound
// DSP settings (trim/filters/EQ/playMode/…) live on the library entry. The
// portable form carries a copy of those settings so a freshly-imported sound
// comes in sounding as intended; a sound already in the library is used
// exactly as the user has it (matching how loading a local preset behaves).

export const PORTABLE_FORMAT = 'noctivago-preset'
export const PORTABLE_VERSION = 2
const MANIFEST_NAME = 'preset.json'
const AUDIO_DIR = 'audio'

// Guards against a hostile bundle on import.
const MAX_BUNDLE_BYTES = 1024 * 1024 * 1024 // 1 GB total
const MAX_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_ENTRIES = 250

function portableSettingsFor(entry) {
  const settings = {}
  for (const key of library.IMPORTED_SETTINGS_KEYS) {
    if (entry[key] !== undefined) settings[key] = entry[key]
  }
  if (Array.isArray(entry.tags) && entry.tags.length > 0) settings.tags = entry.tags
  return settings
}

// Builds { manifest, files } for one saved preset: the manifest object plus
// the list of on-disk audio files to pack into the bundle. Sounds whose
// soundId no longer resolves are dropped; sounds whose audio file is missing
// on disk are kept in the manifest but contribute no file (they'll show as
// "needs file" on import). Returns null if the preset id is unknown.
export function buildPortableBundle(presetId) {
  const preset = listPresets().find((p) => p.id === presetId)
  if (!preset) return null

  const byId = new Map(library.listSounds().map((s) => [s.id, s]))
  const usedNames = new Set()
  const portableSounds = []
  const files = []

  for (const item of preset.sounds) {
    const entry = byId.get(item.soundId)
    if (!entry) continue

    const sourcePath = library.getPlaybackPathForId(entry.id)
    let bundleName = null
    if (sourcePath) {
      // Name the bundled file after the sound's *original* file where we know
      // it (a `copied` sound's on-disk name is an opaque `<id>.ext`), so the
      // zip's contents are readable and `bundleName` matches `fileName`.
      const ext = path.extname(sourcePath)
      const originalBase = path.basename(entry.originalPath || '', path.extname(entry.originalPath || ''))
      const base = `${originalBase || entry.name || 'sound'}${ext}`
      let candidate = base
      let i = 1
      while (usedNames.has(candidate.toLowerCase())) {
        candidate = `${path.basename(base, ext)} (${i})${ext}`
        i += 1
      }
      usedNames.add(candidate.toLowerCase())
      bundleName = candidate
      files.push({ zipName: `${AUDIO_DIR}/${candidate}`, sourcePath })
    }

    portableSounds.push({
      name: entry.name,
      fileName: path.basename(entry.originalPath || ''),
      bundleName,
      fileSizeBytes: entry.fileSizeBytes ?? null,
      durationSeconds: entry.durationSeconds ?? null,
      volume: item.volume ?? entry.volume ?? 0.7,
      settings: portableSettingsFor(entry)
    })
  }

  const manifest = {
    format: PORTABLE_FORMAT,
    formatVersion: files.length > 0 ? 2 : 1,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    name: preset.name,
    // Preset Remix's whole-mix processing (HP/LP/Gain/fade/EQ) - owner
    // inbox request, v0.1.114 follow-up: "add the preset mix on the
    // exported noctivago file." null when the preset has none (matches
    // presets.js's own normalizeWholeMix truthiness convention).
    wholeMix: preset.wholeMix ?? null,
    sounds: portableSounds
  }
  return { manifest, files }
}

// Writes the bundle to outputPath. Always a zip now (even config-only - one
// file inside); Phase-1 raw-JSON files still import fine (see below).
export function writePortableBundle({ manifest, files }, outputPath) {
  const entries = [{ name: MANIFEST_NAME, data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }]
  let totalBytes = 0
  for (const f of files) {
    const data = fs.readFileSync(f.sourcePath)
    totalBytes += data.length
    entries.push({ name: f.zipName, data })
  }
  fs.writeFileSync(outputPath, createZip(entries))
  return { soundCount: manifest.sounds.length, audioCount: files.length, totalBytes }
}

// Only honours entries directly inside `audio/` with a known audio extension
// and no path trickery - everything else in the archive is ignored.
function sanitizeAudioEntryName(entryName) {
  const norm = String(entryName).replace(/\\/g, '/')
  if (!norm.startsWith(`${AUDIO_DIR}/`)) return null
  const rest = norm.slice(AUDIO_DIR.length + 1)
  if (!rest || rest.includes('/') || rest.includes('..')) return null
  if (/[:*?"<>|]/.test(rest)) return null
  const ext = path.extname(rest).slice(1).toLowerCase()
  if (!library.AUDIO_EXTENSIONS.includes(ext)) return null
  return rest
}

// Reads a .ncvpreset file buffer. Returns { ok, manifest, bundle } where
// `bundle` is a Map<lowercased-name, {name, data:Buffer}> for a zip, or null
// for a Phase-1 raw-JSON file.
export function readPortablePresetFile(fileBuffer) {
  if (looksLikeZip(fileBuffer)) {
    let entries
    try {
      entries = readZip(fileBuffer)
    } catch {
      return { ok: false, error: 'That preset file is corrupt or not a valid Noctívago preset.' }
    }
    if (entries.length > MAX_ENTRIES) {
      return { ok: false, error: 'That preset file has too many files inside it.' }
    }
    let total = 0
    for (const e of entries) {
      total += e.data.length
      if (e.data.length > MAX_ENTRY_BYTES || total > MAX_BUNDLE_BYTES) {
        return { ok: false, error: 'That preset file is too large to import.' }
      }
    }

    const manifestEntry = entries.find((e) => e.name === MANIFEST_NAME || e.name === `./${MANIFEST_NAME}`)
    if (!manifestEntry) return { ok: false, error: "That file isn't a Noctívago preset." }
    let manifest
    try {
      manifest = JSON.parse(stripBom(manifestEntry.data.toString('utf8')))
    } catch {
      return { ok: false, error: 'That preset file is corrupt.' }
    }

    const bundle = new Map()
    for (const e of entries) {
      if (e === manifestEntry) continue
      const safe = sanitizeAudioEntryName(e.name)
      if (safe) bundle.set(safe.toLowerCase(), { name: safe, data: e.data })
    }
    return { ok: true, manifest, bundle }
  }

  let manifest
  try {
    manifest = JSON.parse(stripBom(fileBuffer.toString('utf8')))
  } catch {
    return { ok: false, error: "That file couldn't be read as a preset." }
  }
  return { ok: true, manifest, bundle: null }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// Case-insensitive basename match against the current library, preferring an
// entry whose display name also matches.
function matchExistingSound(portableSound, librarySounds) {
  const wantFile = String(portableSound.fileName || '').toLowerCase()
  if (!wantFile) return null
  const candidates = librarySounds.filter(
    (s) => path.basename(s.originalPath || '').toLowerCase() === wantFile
  )
  if (candidates.length === 0) return null
  return candidates.find((s) => s.name === portableSound.name) ?? candidates[0]
}

// Validates a parsed manifest and annotates each sound with how it will be
// resolved: matched to an existing library entry, available from the bundle,
// or needs the user to locate the file.
export function analyzePortablePreset(manifest, bundle = null) {
  if (!manifest || manifest.format !== PORTABLE_FORMAT || !Array.isArray(manifest.sounds)) {
    return { ok: false, error: "That file isn't a Noctívago preset." }
  }
  if (typeof manifest.formatVersion === 'number' && manifest.formatVersion > PORTABLE_VERSION) {
    return {
      ok: false,
      error: 'This preset was made with a newer version of Noctívago. Update the app and try again.'
    }
  }

  const librarySounds = library.listSounds()
  const sounds = manifest.sounds.map((s) => {
    // When the bundle carries this sound's audio, use it - it comes with the
    // sender's exact per-sound settings (trim/filters/EQ/play mode/volume).
    // A basename match against the recipient's own library is NOT good enough
    // here: two unrelated sounds can share a filename ("rain.mp3"), and
    // silently substituting the recipient's own unconfigured copy is exactly
    // the "imported preset plays everything on loop, loudly" bug. Only fall
    // back to matching when the audio isn't in the file (a Phase-1 config-only
    // .ncvpreset, or a sound whose file was missing when the sender exported).
    const bundleKey = String(s.bundleName || s.fileName || '').toLowerCase()
    const fromBundle = Boolean(bundle && bundleKey && bundle.has(bundleKey))
    const match = fromBundle ? null : matchExistingSound(s, librarySounds)
    return {
      name: s.name ?? '(unnamed)',
      fileName: s.fileName ?? '',
      bundleName: s.bundleName ?? null,
      fileSizeBytes: s.fileSizeBytes ?? null,
      durationSeconds: s.durationSeconds ?? null,
      volume: typeof s.volume === 'number' ? s.volume : 0.7,
      settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
      matchedSoundId: match ? match.id : null,
      matchedName: match ? match.name : null,
      fromBundle
    }
  })

  return {
    ok: true,
    name: manifest.name ?? 'Imported preset',
    appVersion: manifest.appVersion ?? null,
    // Absent entirely on a Phase-1 file predating this field, or an older
    // export from before Preset Remix existed - null either way, same as a
    // preset that just never had whole-mix settings.
    wholeMix: manifest.wholeMix ?? null,
    sounds
  }
}

// Adds a located audio file (or reuses an existing library entry if that
// exact file is already registered) and applies the portable settings.
export function importLocatedSound(filePath, portableSound, { keepCopy = false } = {}) {
  const existing = library.findSoundByOriginalPath(filePath)
  if (existing) return { soundId: existing.id, reused: true }

  const entry = library.addSound({
    path: filePath,
    name: portableSound?.name || path.parse(filePath).name,
    keepCopy
  })
  library.applyImportedSettings(entry.id, portableSound?.settings || {})
  // The preset carries the per-sound mix volume separately from the shaping
  // settings; seed the fresh entry with it so it also sounds right when
  // played on its own, not only when this exact preset is loaded.
  if (typeof portableSound?.volume === 'number') {
    library.updateVolume(entry.id, portableSound.volume)
  }
  return { soundId: entry.id, reused: false }
}

// --- bundle import sessions ------------------------------------------------
// A zip's audio is extracted to a temp dir when the import dialog opens, kept
// keyed by a session id, and cleaned up when the dialog is confirmed or
// cancelled (plus a blunt sweep on startup, since a session never outlives
// the app).

const importSessions = new Map()

function importTmpRoot() {
  return path.join(app.getPath('userData'), 'preset-import-tmp')
}

export function stashImportBundle(bundle) {
  const id = crypto.randomUUID()
  const dir = path.join(importTmpRoot(), id)
  fs.mkdirSync(dir, { recursive: true })
  for (const { name, data } of bundle.values()) {
    fs.writeFileSync(path.join(dir, path.basename(name)), data)
  }
  importSessions.set(id, dir)
  return id
}

function importSessionFile(id, name) {
  const dir = importSessions.get(id)
  if (!dir || !name) return null
  const p = path.join(dir, path.basename(name))
  return fs.existsSync(p) ? p : null
}

export function clearImportSession(id) {
  const dir = importSessions.get(id)
  if (!dir) return
  fs.rmSync(dir, { recursive: true, force: true })
  importSessions.delete(id)
}

export function sweepImportSessions() {
  try {
    fs.rmSync(importTmpRoot(), { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

// "Create preset" from the import dialog. Resolves every sound (existing
// match, the user's manual Locate, or the bundle), saves the preset, and
// tears down the temp session.
export function finalizeImport({ importSessionId, name, sounds, wholeMix }) {
  const resolved = []
  for (const s of sounds || []) {
    let soundId = s.matchedSoundId
    if (!soundId && s.fromBundle && importSessionId) {
      const bundledPath = importSessionFile(importSessionId, s.bundleName || s.fileName)
      if (bundledPath) {
        soundId = importLocatedSound(bundledPath, s, { keepCopy: true }).soundId
      }
    }
    if (soundId) resolved.push({ soundId, volume: s.volume })
  }
  if (importSessionId) clearImportSession(importSessionId)

  if (resolved.length === 0) return { ok: false, error: 'None of the sounds could be added.' }
  const preset = savePreset({ name: name || 'Imported preset', sounds: resolved, wholeMix: wholeMix ?? null })
  return { ok: true, preset, soundCount: resolved.length }
}
