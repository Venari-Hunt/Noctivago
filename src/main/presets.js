import Store from 'electron-store'
import crypto from 'node:crypto'
import { DEFAULT_SOUND_VOLUME } from '../shared/constants.js'

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

// Fluctuation (v0.1.166): slow random volume drift on the whole mix / a
// group bus - the multi-sound counterpart of a sound's own filters.
// fluctuation. Volume axis, plus pan (v0.1.217) and per-sound pitch
// (v0.1.218) for a Sound Group - see normalizeMixFluctuation. Stored as null when disabled so the "does this have
// whole-mix settings" truthiness checks stay simple; a group keeps it as a
// field of its always-present filters object (also null when off).
function normalizeMixFluctuation(input, { groupAxes = false } = {}) {
  const src = input && typeof input === 'object' ? input : null
  const volume = normalizeMixAxis(src?.volume, { lo: 0, hi: 1, min: 0.5, max: 1, perSound: groupAxes })
  // Sound Groups only (a whole mix has no UI for these): pan drift
  // (v0.1.217), and pitch drift (v0.1.218), which a bus can't do itself, so
  // it's always "each sound on its own".
  const pan = groupAxes ? normalizeMixAxis(src?.pan, { lo: -1, hi: 1, min: -0.5, max: 0.5, perSound: true }) : null
  const pitchAxis = groupAxes ? normalizeMixAxis(src?.pitch, { lo: -6, hi: 6, min: -1, max: 1, perSound: true }) : null
  const pitch = pitchAxis ? { ...pitchAxis, perSound: true } : null
  if (!volume && !pan && !pitch) return null
  return { ...(volume ? { volume } : {}), ...(pitch ? { pitch } : {}), ...(pan ? { pan } : {}) }
}

// One drift axis, or null when absent/disabled.
// perSound: whether this axis may carry the Sound Group "each sound on its
// own" flag (v0.1.218).
function normalizeMixAxis(axis, { lo: rangeLo, hi: rangeHi, min: defMin, max: defMax, perSound = false }) {
  if (!axis || typeof axis !== 'object' || !axis.enabled) return null
  const min = clamp(axis.min, rangeLo, rangeHi, defMin)
  const max = clamp(axis.max, rangeLo, rangeHi, defMax)
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  // v0.1.176: flat-seconds timing (was 0..1 changeRate/transition). A
  // pre-v0.1.176 preset still carries the old fields; map them the same way
  // Modulator.js's resolveFluctuationTiming does so the migration is lossless.
  let changeMinSeconds
  let changeMaxSeconds
  let transitionSeconds
  if (Number.isFinite(axis.changeMinSeconds) || Number.isFinite(axis.transitionSeconds)) {
    const cLo = clamp(axis.changeMinSeconds, 0.2, 300, 6)
    const cHi = clamp(axis.changeMaxSeconds, 0.2, 300, 14)
    changeMinSeconds = Math.min(cLo, cHi)
    changeMaxSeconds = Math.max(cLo, cHi)
    transitionSeconds = clamp(axis.transitionSeconds, 0, 120, 8)
  } else {
    const r = clamp(axis.changeRate, 0, 1, 0.5)
    const t = clamp(axis.transition, 0, 1, 0.5)
    const centre = 20 + (1.5 - 20) * r
    const tau = 9 + (0.15 - 9) * t
    changeMinSeconds = Math.round(centre * 0.6 * 10) / 10
    changeMaxSeconds = Math.round(centre * 1.4 * 10) / 10
    transitionSeconds = Math.round(tau * 3 * 10) / 10
  }
  return {
    enabled: true,
    fullyRandom: Boolean(axis.fullyRandom),
    biasEnabled: axis.biasEnabled !== false,
    ...(perSound ? { perSound: Boolean(axis.perSound) } : {}),
    min: lo,
    max: hi,
    bias: clamp(axis.bias, lo, hi, (lo + hi) / 2),
    changeMinSeconds,
    changeMaxSeconds,
    transitionSeconds
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
    fluctuation: normalizeMixFluctuation(input.fluctuation),
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
    normalized.fluctuation === null &&
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
    // Occlusion (v0.1.182) - group-only, see src/shared/constants.js's
    // applyOcclusionToFilters for the full reasoning. Not part of
    // normalizeWholeMix - a whole preset has no "inside/outside" of itself.
    occlusion: clamp(src.occlusion, 0, 1, 0),
    fluctuation: normalizeMixFluctuation(src.fluctuation, { groupAxes: true }),
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

// Per-preset sound overrides (planned 2026-09-12): the same 8 keys
// src/shared/constants.js's OVERRIDABLE_SOUND_KEYS names (loopStart,
// loopEnd, filters, crossfadeSeconds, speedPitch, playMode, scatter,
// schedule) - null means "inherit everything from the sound's own baseline
// in library.js", the lazy-inheritance default. No field clamping here,
// same as the library.js update* functions this data ultimately feeds -
// those have always been pure passthroughs (Remix's own controls are the
// trusted source), so this stays consistent rather than re-validating a
// shape that's already validated at the point of entry.
function normalizeSoundOverride(input) {
  return input && typeof input === 'object' ? { ...input } : null
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
      volume: s.volume,
      overrides: normalizeSoundOverride(s.overrides)
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
// markIncluded: injected (library.js's updateIncluded), not imported
// directly - presets.js otherwise has no Electron dependency at all
// (electron-store aside), which is what lets test/presets.test.js run
// under plain node --test with no Electron stub; a static import of
// library.js (which reaches electron via ffmpegPath.js) would break that.
export function updatePresetGroups(id, groups, { markIncluded } = {}) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  const normalized = normalizeGroups(groups)

  // Owner request (2026-09-17, "frog is on the group and on the mix and it
  // isn't playing... same thing for outside group" - the outside group's
  // members were never added to the mix at all, only to the group): joining
  // a Sound Group now also joins the mix, one-way only - removing a sound
  // from the mix later leaves its group membership untouched, and a sound
  // already in the mix when it joins a group is unaffected. Every group-
  // membership write (the Mixer's right-click menu, its "+ new group"
  // dialog, and the Remix plugin's Group-mode member checklist) already
  // funnels through this one function via presets:updateGroups, so this is
  // the single place that needs the rule rather than three separate copies.
  const before = new Set((presets[idx].groups ?? []).flatMap((g) => g.soundIds ?? []))
  const after = new Set(normalized.flatMap((g) => g.soundIds ?? []))
  const newlyJoined = [...after].filter((soundId) => !before.has(soundId))

  let sounds = presets[idx].sounds ?? []
  for (const soundId of newlyJoined) {
    if (!sounds.some((s) => s.soundId === soundId)) {
      sounds = [...sounds, { soundId, volume: DEFAULT_SOUND_VOLUME, overrides: null }]
    }
    markIncluded?.(soundId, true)
  }

  presets[idx] = { ...presets[idx], sounds, groups: normalized }
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

// Edits an existing preset's own sound list/volumes in place - driven both
// by the Mixer's explicit "Save X now" button and, since v0.1.178, by the
// debounced autosave that fires on every mix mutation while a preset is
// loaded (owner request, 2026-09-10: "Are presets being autosaved? If not
// they should be"; original explicit-button request 2026-09-02: "Save button
// for saving changes made on the current preset without the need of creating
// a new one"). Mirrors savePreset's own
// sounds.map shape exactly so a preset updated this way is byte-identical in
// structure to one created fresh. name/createdAt/wholeMix are left untouched
// - this only ever touches the sound list, matching the button's own scope.
// Returns the updated preset, or null if the id is unknown.
//
// BUG FIX (v0.1.223): a sound already in the preset keeps its stored
// overrides, whatever the caller sends. Overrides belong to Remix
// (updatePresetSoundOverride below); the Mixer only knows the copy it
// cached when the preset loaded, and a sound added during the session
// wasn't in that copy at all. Its autosave (any volume drag) then wrote
// `overrides: null` and erased a pan the owner had just saved in Remix
// ("changes made in the remix tab still aren't consistently transferring to
// the mixer tab"). Only a sound new to the preset takes the caller's value.
export function updatePresetSounds(id, sounds) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === id)
  if (idx === -1) return null
  const storedOverrides = new Map((presets[idx].sounds ?? []).map((s) => [s.soundId, s.overrides ?? null]))
  presets[idx] = {
    ...presets[idx],
    sounds: sounds.map((s) => ({
      soundId: s.soundId,
      volume: s.volume,
      overrides: storedOverrides.has(s.soundId) ? storedOverrides.get(s.soundId) : normalizeSoundOverride(s.overrides)
    }))
  }
  store.set('presets', presets)
  return presets[idx]
}

// The Remix plugin's Sound-mode Save, when the open sound is a member of
// the preset currently active in the Mixer (see plugins/editor/index.js's
// performSave) - writes just that one sound's overrides, leaving the rest
// of the preset (name/wholeMix/groups/every other sound) untouched. `null`
// clears any existing override, reverting that sound back to pure
// inheritance from its own baseline. No-ops (returns null) if the preset or
// the sound isn't found - there's nothing to attach an override to (a sound
// not already a member of this preset's own `sounds[]` has no override slot;
// the caller is expected to fall back to writing baseline in that case).
export function updatePresetSoundOverride(presetId, soundId, overridePatch) {
  const presets = store.get('presets')
  const idx = presets.findIndex((p) => p.id === presetId)
  if (idx === -1) return null
  const soundIdx = presets[idx].sounds.findIndex((s) => s.soundId === soundId)
  if (soundIdx === -1) return null
  const sounds = [...presets[idx].sounds]
  sounds[soundIdx] = { ...sounds[soundIdx], overrides: normalizeSoundOverride(overridePatch) }
  presets[idx] = { ...presets[idx], sounds }
  store.set('presets', presets)
  return presets[idx]
}

// Main-process-only helper (no IPC channel of its own) - used by the
// sound:// protocol handler (src/main/index.js) to resolve loop-clip
// bake-eligibility against a specific preset's effective view of a sound,
// since the baked-clip cache/staleness fields live on the one global
// baseline row and must be compared against effective (possibly
// preset-overridden), not raw baseline, settings.
export function getSoundOverride(presetId, soundId) {
  if (!presetId) return null
  const preset = store.get('presets').find((p) => p.id === presetId)
  return preset?.sounds.find((s) => s.soundId === soundId)?.overrides ?? null
}

// "Always a preset loaded" (planned 2026-09-12): a no-op if any preset
// already exists, otherwise force-creates one named "Default" so the app
// never runs with zero presets. `fallbackSounds` lets the two callers seed
// it appropriately instead of always starting empty - src/main/index.js's
// startup bootstrap passes whatever's currently `included` pre-migration
// (so an existing user's in-progress mix isn't orphaned the moment "always
// a preset loaded" becomes real), and deletePreset below passes the
// just-deleted preset's own sounds[] (overrides included) so deleting your
// last preset doesn't jarringly snap every sound back to pure baseline.
export function ensureDefaultPreset(fallbackSounds = []) {
  if (store.get('presets').length > 0) return null
  return savePreset({ name: 'Default', sounds: fallbackSounds, wholeMix: null, groups: [] })
}

// Returns the auto-created replacement Default preset when this deletion
// empties the list (see ensureDefaultPreset), or null when other presets
// remain (the renderer decides what to do in that case - see
// tabs/mixer/index.js's deletePreset).
export function deletePreset(id) {
  const presets = store.get('presets')
  const deleted = presets.find((p) => p.id === id)
  store.set('presets', presets.filter((p) => p.id !== id))
  return ensureDefaultPreset(deleted?.sounds ?? [])
}
