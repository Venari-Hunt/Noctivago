// The per-sound part of the Mixer's right-click menu, as plain data. Each
// item names an action; the Mixer maps actions to its own handlers. Sound
// Groups and "Edit in Remix" are added around this by the Mixer itself.

import { DEFAULT_VOLUME } from '../../../core/volumeScale.js'

// sound: { status, loading, included, muted, soloed, volume }
export function soundMenuItems(sound) {
  const missing = sound.status === 'missing'
  const busy = missing || sound.loading
  return [
    { label: sound.included ? 'Stop (remove from mix)' : 'Play (add to mix)', action: 'toggleIncluded', disabled: busy },
    { label: sound.soloed ? 'Unsolo' : 'Solo', action: 'toggleSolo', disabled: busy },
    { label: sound.muted ? 'Unmute' : 'Mute', action: 'toggleMute', disabled: busy },
    { label: 'Reset volume', action: 'resetVolume', disabled: busy || sound.volume === DEFAULT_VOLUME },
    { separator: true },
    { label: 'Rename…', action: 'rename' },
    { label: 'Edit tags…', action: 'editTags' },
    { label: 'Duplicate', action: 'duplicate', disabled: missing },
    { label: 'Show file in folder', action: 'showInFolder', disabled: missing }
  ]
}

// The "Presets" submenu: every preset, ticked when it holds the sound.
// The loaded preset's sounds are the mix, so its tick follows inMix and
// clicking it is the same as Play/Stop.
export function presetMenuItems(presets, soundId, activePresetId, inMix) {
  return presets.map((p) => {
    const member = p.id === activePresetId ? inMix : (p.sounds ?? []).some((s) => s.soundId === soundId)
    return { label: (member ? '✓ ' : '') + p.name + (p.id === activePresetId ? ' (loaded)' : ''), presetId: p.id, member }
  })
}

// A preset's sounds after toggling one in or out. A sound joining keeps its
// current Mixer volume.
export function togglePresetSound(sounds, soundId, volume) {
  if (sounds.some((s) => s.soundId === soundId)) return sounds.filter((s) => s.soundId !== soundId)
  return [...sounds, { soundId, volume, overrides: null }]
}

// Always the menu's last item, after the Sound Group section, so it's the
// hardest one to hit by accident.
export const REMOVE_MENU_ITEM = { label: 'Remove from library', action: 'remove' }

// "Rain" → "Rain (copy)", "Rain (copy)" → "Rain (copy 2)", skipping names
// already in the library.
export function duplicateName(name, existingNames) {
  const taken = new Set(existingNames)
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '')
  let candidate = `${base} (copy)`
  for (let n = 2; taken.has(candidate); n++) candidate = `${base} (copy ${n})`
  return candidate
}
