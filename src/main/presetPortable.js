import { app } from 'electron'
import path from 'node:path'
import * as library from './library.js'
import { listPresets } from './presets.js'

// Portable preset files (.ncvpreset, JSON inside) — a preset plus everything
// needed to reproduce it on another machine EXCEPT the audio itself. Bundling
// the audio is a deliberate later phase; for now an imported preset lists any
// sound whose file isn't already in the library and lets the user locate it.
//
// A local preset is only { soundId, volume } (see presets.js) — the per-sound
// DSP settings (trim/filters/EQ/playMode/…) live on the library entry, shared
// across every preset that references it. The portable form carries a copy of
// those settings so a freshly-located sound comes in sounding as intended; a
// sound already in the library is used exactly as the user has it, matching
// how loading a local preset already behaves (it never rewrites a sound's
// settings either).

export const PORTABLE_FORMAT = 'noctivago-preset'
export const PORTABLE_VERSION = 1

function portableSettingsFor(entry) {
  const settings = {}
  for (const key of library.IMPORTED_SETTINGS_KEYS) {
    if (entry[key] !== undefined) settings[key] = entry[key]
  }
  if (Array.isArray(entry.tags) && entry.tags.length > 0) settings.tags = entry.tags
  return settings
}

// Builds the manifest for one saved preset. Sounds whose soundId no longer
// resolves to a library entry are dropped (the preset is already broken for
// them locally). Returns null if the preset id is unknown.
export function buildPortablePreset(presetId) {
  const preset = listPresets().find((p) => p.id === presetId)
  if (!preset) return null

  const sounds = library.listSounds()
  const byId = new Map(sounds.map((s) => [s.id, s]))

  const portableSounds = preset.sounds
    .map((item) => {
      const entry = byId.get(item.soundId)
      if (!entry) return null
      return {
        name: entry.name,
        fileName: path.basename(entry.originalPath || ''),
        fileSizeBytes: entry.fileSizeBytes ?? null,
        durationSeconds: entry.durationSeconds ?? null,
        volume: item.volume ?? entry.volume ?? 0.7,
        settings: portableSettingsFor(entry)
      }
    })
    .filter(Boolean)

  return {
    format: PORTABLE_FORMAT,
    formatVersion: PORTABLE_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    name: preset.name,
    sounds: portableSounds
  }
}

// Case-insensitive basename match against the current library, preferring an
// entry whose display name also matches. NTFS/Windows-only app, so a plain
// lowercase compare is the right key (same reasoning as library.js's own
// path dedup).
function matchExistingSound(portableSound, librarySounds) {
  const wantFile = String(portableSound.fileName || '').toLowerCase()
  if (!wantFile) return null
  const candidates = librarySounds.filter(
    (s) => path.basename(s.originalPath || '').toLowerCase() === wantFile
  )
  if (candidates.length === 0) return null
  return (
    candidates.find((s) => s.name === portableSound.name) ?? candidates[0]
  )
}

// Validates a parsed manifest and annotates each sound with whether it's
// already in the library. Returns { ok:false, error } on a malformed file.
export function analyzePortablePreset(manifest) {
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
    const match = matchExistingSound(s, librarySounds)
    return {
      name: s.name ?? '(unnamed)',
      fileName: s.fileName ?? '',
      fileSizeBytes: s.fileSizeBytes ?? null,
      durationSeconds: s.durationSeconds ?? null,
      volume: typeof s.volume === 'number' ? s.volume : 0.7,
      settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
      matchedSoundId: match ? match.id : null,
      matchedName: match ? match.name : null
    }
  })

  return { ok: true, name: manifest.name ?? 'Imported preset', appVersion: manifest.appVersion ?? null, sounds }
}

// Called after the user has located the file for one missing sound. Reuses
// an existing library entry if that exact file is already registered
// (locating a file you already have shouldn't duplicate it); otherwise adds
// it and applies the portable per-sound settings.
export function importLocatedSound(filePath, portableSound) {
  const existing = library.findSoundByOriginalPath(filePath)
  if (existing) return { soundId: existing.id, reused: true }

  const entry = library.addSound({
    path: filePath,
    name: portableSound?.name || path.parse(filePath).name,
    keepCopy: false
  })
  library.applyImportedSettings(entry.id, portableSound?.settings || {})
  return { soundId: entry.id, reused: false }
}
