// Rules for the app-wide top bar (preset, transport, actions). No DOM here -
// components/ turns these into markup, and the owners of each piece of state
// (the Mixer, the sleep timer, main.js) push it in through toolbar/index.jsx.

export const INITIAL_TOOLBAR_STATE = {
  presetName: null,
  // How many sounds are in the mix (the player's subtitle).
  mixCount: 0,
  playing: false,
  // Master volume as linear gain; the slider maps it (shared/volumeScale.js).
  volumeGain: 1,
  muted: false,
  sleepActive: false,
  sleepRemaining: ''
}

// Order is the "+" menu's order. `id` is what onAddSound receives.
export const ADD_SOUND_ITEMS = [
  { id: 'file', label: 'Add file…', icon: 'file' },
  { id: 'link', label: 'Add from link…', icon: 'link' },
  { id: 'record', label: 'Record audio…', icon: 'mic' },
  { id: 'folder-preset', label: 'Add folder as preset…', icon: 'folder', divider: true },
  { id: 'folder-tag', label: 'Add folder as tag…', icon: 'tag' },
  { id: 'watch-folder', label: 'Watch a folder…', icon: 'eye' }
]

// The title-bar preset pill: the preset name, then '· N sounds' in dim text.
export function presetPill(presetName, mixCount = 0) {
  if (!presetName) return { label: 'No preset', count: '', title: 'No preset loaded: click to pick one' }
  return {
    label: presetName,
    count: '· ' + (mixCount === 1 ? '1 sound' : mixCount + ' sounds'),
    title: 'Preset playing in the Mixer: click for the presets'
  }
}

// `title` keeps the "all" scope (vs. a single sound) on hover even though
// the glyph doesn't say it.
export function playButtonTitle(playing) {
  return playing ? 'Pause mix' : 'Play mix'
}

export function muteButtonTitle(muted) {
  return muted ? 'Unmute all' : 'Mute all'
}

export function sleepButtonTitle(active) {
  return active ? 'Sleep timer (running)' : 'Sleep timer'
}
