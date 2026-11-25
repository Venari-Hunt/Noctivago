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
  sleepRemaining: '',
  // Share of the timer still to run, 0-100: the amber ring round the moon.
  sleepPercent: 0
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

export function sleepButtonTitle(active, remaining = '') {
  if (!active) return 'Sleep timer'
  return remaining ? `Sleep timer: ${remaining} left` : 'Sleep timer (running)'
}

// The running timer's ring (owner, 2026-11-21): its length is the share of the
// whole timer still to run, so it closes as the time runs out. Rounded to a
// tenth of a percent so a second's tick on a long timer still moves it.
export function sleepRingPercent(firesAt, startedAt, now = Date.now()) {
  const total = firesAt - startedAt
  if (!Number.isFinite(total) || total <= 0) return 0
  const left = Math.min(total, Math.max(0, firesAt - now))
  return Math.round((left / total) * 1000) / 10
}
