// Rules for the app-wide top bar (preset, transport, actions). No DOM here -
// components/ turns these into markup, and the owners of each piece of state
// (the Mixer, the sleep timer, main.js) push it in through toolbar/index.jsx.

export const INITIAL_TOOLBAR_STATE = {
  isDev: false,
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

export function presetIndicator(presetName, mixCount = 0) {
  const hasPreset = Boolean(presetName)
  const sounds = mixCount === 1 ? '1 sound' : `${mixCount} sounds`
  return {
    hasPreset,
    label: hasPreset ? presetName : 'No preset',
    sub: hasPreset ? `${sounds} · saves as you go` : mixCount > 0 ? `${sounds} in the mix` : 'No sounds yet',
    title: hasPreset ? `Editing preset "${presetName}"` : 'No preset loaded'
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
