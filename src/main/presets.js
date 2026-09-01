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
// own filters.eq (see library.js) - kept here so the Preset Remix plugin and
// the renderer's WholeMixChain agree without a shared import.
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
    eq: Array.isArray(input.eq) ? input.eq.map(normalizeEqBand).filter(Boolean) : []
  }
  // A fully-neutral config is stored as null so the "does this preset have
  // whole-mix settings" check elsewhere stays a simple truthiness test.
  const neutral =
    normalized.highpassHz === 0 &&
    normalized.lowpassHz === 20000 &&
    normalized.gainDb === 0 &&
    normalized.fadeInSeconds === 0 &&
    normalized.eq.length === 0
  return neutral ? null : normalized
}

export function listPresets() {
  return store.get('presets')
}

export function savePreset({ name, sounds, wholeMix }) {
  const preset = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    wholeMix: normalizeWholeMix(wholeMix),
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

// Edits an existing preset's whole-mix processing in place (the Preset Remix
// plugin's Save). Returns the updated preset, or null if the id is unknown.
export function updatePresetWholeMix(id, wholeMix) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  presets[idx] = { ...presets[idx], wholeMix: normalizeWholeMix(wholeMix) }
  store.set('presets', presets)
  return presets[idx]
}

export function deletePreset(id) {
  const presets = store.get('presets')
  store.set('presets', presets.filter((p) => p.id !== id))
}
