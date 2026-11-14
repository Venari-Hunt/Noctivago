// The app's keyboard shortcuts: one table, read by the keymap (keymap.js) and
// by Settings > Help, so the page can never list a key that does nothing.
// Rules only, no DOM: matchShortcut() turns a key event into an action id.

export const SHORTCUTS = [
  { id: 'play', title: 'Play or pause', keys: ['Space'], plain: true },
  { id: 'search', title: 'Search sounds', keys: ['Ctrl', 'F'], ctrl: true, key: 'f' },
  { id: 'save', title: 'Save preset changes', keys: ['Ctrl', 'S'], ctrl: true, key: 's' },
  { id: 'settings', title: 'Open or close Settings', keys: ['Ctrl', ','], ctrl: true, key: ',' },
  // Remix plugin: it handles the key itself; listed here so Help shows it.
  { id: 'marker', title: 'Add a marker at the playhead (Remix)', keys: ['Ctrl', 'M'], ctrl: true, key: 'm' },
  { id: 'tab', title: 'Go to tab 1 to 9', keys: ['Ctrl', '1-9'], ctrl: true },
  { id: 'fullscreen', title: 'Full screen', keys: ['F11'], any: true, key: 'F11' },
  { id: 'help', title: 'Show shortcuts', keys: ['?'], plain: true, key: '?' }
]

// Keys typed into a field belong to the field.
export function isTypingTarget(el) {
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

// Returns { id, tab? } or null. `ctx.typing`: focus is in a field;
// `ctx.onControl`: focus is on a button or link (Space presses it);
// `ctx.modalOpen`: a dialog is open, so plain keys are left alone.
export function matchShortcut(event, ctx = {}) {
  const ctrl = event.ctrlKey || event.metaKey
  if (event.altKey) return null
  if (event.key === 'F11') return { id: 'fullscreen' }
  if (ctrl && !event.shiftKey && /^[1-9]$/.test(event.key)) return { id: 'tab', tab: Number(event.key) - 1 }
  if (ctrl && !event.shiftKey) {
    const hit = SHORTCUTS.find((s) => s.ctrl && s.key === event.key.toLowerCase())
    return hit ? { id: hit.id } : null
  }
  if (ctrl || ctx.typing || ctx.modalOpen) return null
  if (event.key === ' ' && !event.shiftKey && !ctx.onControl) return { id: 'play' }
  if (event.key === '?') return { id: 'help' }
  return null
}
