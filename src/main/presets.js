import Store from 'electron-store'
import crypto from 'node:crypto'

const store = new Store({
  name: 'presets',
  defaults: { presets: [] }
})

// Whole-mix processing saved on a preset and applied to live playback
// whenever that preset is loaded in the Mixer (the live counterpart of the
// Export tab's "Whole-mix processing" section). `null` / absent = neutral.
// EQ (`eq`) is a variable-length band array in the same shape as a sound's
// own filters.eq (see library.js) - kept here so the Remix plugin's Preset
// mode and the renderer's WholeMixChain agree without a shared import.
const EQ_BAND_TYPES = ['off', 'lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking']

function clamp(value, lo, hi, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function normalizeEqBand(band) {
  if (!band || typeof band !== 'object') return null
  return {
    freqHz: clamp(band.freqHz, 20, 20000, 1000),
    gainDb: clamp(band.gainDb, -30, 30, 0),
    q: clamp(band.q, 0.1, 20, 1),
    type: EQ_BAND_TYPES.includes(band.type) ? band.type : 'peaking',
    slope: band.slope === 'steep' ? 'steep' : 'gentle',
    muted: Boolean(band.muted)
  }
}

export function normalizeWholeMix(input) {
  if (!input || typeof input !== 'object') return null
  const normalized = {
    highpassHz: clamp(input.highpassHz, 0, 2000, 0),
    lowpassHz: clamp(input.lowpassHz, 150, 20000, 20000),
    gainDb: clamp(input.gainDb, -24, 24, 0),
    fadeInSeconds: clamp(input.fadeInSeconds, 0, 60, 0),
    // Echo/Reverb, matching a sound's own filters.echoDelayMs/echoDecay/
    // reverbSizeMs/reverbMix shape - the owner's own direction (2026-09-06):
    // "Echo delay is NOT single-sound-specific" the way the Remix tab's
    // sound-picker/waveform/trim controls are, and (confirmed 2026-09-06,
    // same thread) neither is Reverb - both belong in whole-mix/group
    // filters alongside HP/LP/Gain, not just in a per-sound's own filters.
    echoDelayMs: clamp(input.echoDelayMs, 0, 1500, 0),
    echoDecay: clamp(input.echoDecay, 0, 0.85, 0),
    reverbSizeMs: clamp(input.reverbSizeMs, 0, 4000, 0),
    reverbMix: clamp(input.reverbMix, 0, 1, 0),
    eq: Array.isArray(input.eq) ? input.eq.map(normalizeEqBand).filter(Boolean) : []
  }
  // A fully-neutral config is stored as null so the "does this preset have
  // whole-mix settings" check elsewhere stays a simple truthiness test.
  const neutral =
    normalized.highpassHz === 0 &&
    normalized.lowpassHz === 20000 &&
    normalized.gainDb === 0 &&
    normalized.fadeInSeconds === 0 &&
    normalized.echoDelayMs === 0 &&
    normalized.echoDecay === 0 &&
    normalized.reverbSizeMs === 0 &&
    normalized.reverbMix === 0 &&
    normalized.eq.length === 0
  return neutral ? null : normalized
}

// "Sound Groups" - a named, non-destructive submix bus scoped to one preset
// (see the Remix plugin's Group mode + the Mixer's right-click "Add to
// group…" menu). A subset of the preset's sounds route
// through one shared highpass/lowpass/EQ/gain chain instead of straight to
// masterGain, so they can be shaped together ("make these sound like
// they're outside a house") without touching any sound's own filters. Same
// filter shape as wholeMix minus fadeInSeconds (a group has no "on load"
// moment of its own to fade in on) - always stored as a real object, never
// collapsed to null on neutral, since a group's *existence* (its name +
// membership) is the meaningful part even when its filters are untouched.
export function normalizeGroupFilters(input) {
  const src = input && typeof input === 'object' ? input : {}
  return {
    highpassHz: clamp(src.highpassHz, 0, 2000, 0),
    lowpassHz: clamp(src.lowpassHz, 150, 20000, 20000),
    gainDb: clamp(src.gainDb, -24, 24, 0),
    // See normalizeWholeMix's own comment - same echo/reverb addition, same reason.
    echoDelayMs: clamp(src.echoDelayMs, 0, 1500, 0),
    echoDecay: clamp(src.echoDecay, 0, 0.85, 0),
    reverbSizeMs: clamp(src.reverbSizeMs, 0, 4000, 0),
    reverbMix: clamp(src.reverbMix, 0, 1, 0),
    eq: Array.isArray(src.eq) ? src.eq.map(normalizeEqBand).filter(Boolean) : []
  }
}

function normalizeGroup(input) {
  if (!input || typeof input !== 'object') return null
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Group'
  return {
    id: typeof input.id === 'string' && input.id ? input.id : crypto.randomUUID(),
    name,
    // A sound belongs to at most one group per preset (see the Mixer's
    // toggleGroupMembership, which enforces this on write) - soundIds is
    // just deduped here, not cross-checked against other groups, since this
    // function only ever sees one group at a time.
    soundIds: Array.isArray(input.soundIds) ? [...new Set(input.soundIds.filter((s) => typeof s === 'string'))] : [],
    filters: normalizeGroupFilters(input.filters)
  }
}

export function normalizeGroups(input) {
  return Array.isArray(input) ? input.map(normalizeGroup).filter(Boolean) : []
}

export function listPresets() {
  return store.get('presets')
}

export function savePreset({ name, sounds, wholeMix, groups }) {
  const preset = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    wholeMix: normalizeWholeMix(wholeMix),
    groups: normalizeGroups(groups),
    sounds: sounds.map((s) => ({
      soundId: s.soundId,
      type: 'local',
      volume: s.volume,
      effects: []
    }))
  }
  const presets = store.get('presets')
  presets.push(preset)
  store.set('presets', presets)
  return preset
}

// Edits an existing preset's Sound Groups in place (create/rename/delete/
// change membership/change filters all go through this - the renderer
// always sends the full desired array, same "replace the whole field"
// pattern updatePresetWholeMix/updatePresetSounds already use). Returns the
// updated preset, or null if the id is unknown.
export function updatePresetGroups(id, groups) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  presets[idx] = { ...presets[idx], groups: normalizeGroups(groups) }
  store.set('presets', presets)
  return presets[idx]
}

// Edits an existing preset's whole-mix processing in place (the Remix
// plugin's Preset-mode Save). Returns the updated preset, or null if the id is unknown.
export function updatePresetWholeMix(id, wholeMix) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  presets[idx] = { ...presets[idx], wholeMix: normalizeWholeMix(wholeMix) }
  store.set('presets', presets)
  return presets[idx]
}

// Edits an existing preset's own sound list/volumes in place (the Mixer's
// "Save changes" button on whatever preset was last loaded - direct request,
// 2026-09-02: "Save button for saving changes made on the current preset
// without the need of creating a new one"). Mirrors savePreset's own
// sounds.map shape exactly so a preset updated this way is byte-identical in
// structure to one created fresh. name/createdAt/wholeMix are left untouched
// - this only ever touches the sound list, matching the button's own scope.
// Returns the updated preset, or null if the id is unknown.
export function updatePresetSounds(id, sounds) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  presets[idx] = {
    ...presets[idx],
    sounds: sounds.map((s) => ({
      soundId: s.soundId,
      type: 'local',
      volume: s.volume,
      effects: []
    }))
  }
  store.set('presets', presets)
  return presets[idx]
}

export function deletePreset(id) {
  const presets = store.get('presets')
  store.set('presets', presets.filter((p) => p.id !== id))
}
