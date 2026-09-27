// Rules for the app-wide top bar (preset, transport, actions). No DOM here -
// components/ turns these into markup, and the owners of each piece of state
// (the Mixer, the sleep timer, main.js) push it in through toolbar/index.jsx.

export const INITIAL_TOOLBAR_STATE = {
  isDev: false,
  presetName: null,
  playing: false,
  // Bipolar slider position, 0-100 - the centre is unity gain (core/volumeScale.js).
  volumePosition: 50,
  muted: false,
  sleepActive: false,
  sleepRemaining: ''
}

// Order is the "+" menu's order. `id` is what onAddSound receives.
export const ADD_SOUND_ITEMS = [
  { id: 'file', label: 'Add file…' },
  { id: 'folder-preset', label: 'Add folder as preset…' },
  { id: 'folder-tag', label: 'Add folder as tag…' },
  { id: 'watch-folder', label: 'Watch a folder…' },
  { id: 'record', label: 'Record audio…' },
  { id: 'link', label: 'Add from link…' }
]

export function presetIndicator(presetName) {
  const hasPreset = Boolean(presetName)
  return {
    hasPreset,
    label: hasPreset ? presetName : 'No preset',
    title: hasPreset ? `Editing preset "${presetName}"` : 'No preset loaded'
  }
}

// `title` keeps the "all" scope (vs. a single sound) on hover even though
// the glyph doesn't say it.
export function playButtonTitle(playing) {
  return playing ? 'Pause all' : 'Play all'
}

export function muteButtonTitle(muted) {
  return muted ? 'Unmute' : 'Mute'
}

export function sleepButtonTitle(active) {
  return active ? 'Sleep timer (running)' : 'Sleep timer'
}
