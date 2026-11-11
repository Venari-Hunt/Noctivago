import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { INITIAL_TOOLBAR_STATE } from './domain/toolbar.js'
import { Toolbar } from './components/Toolbar.jsx'
import { NavEnd } from './components/NavEnd.jsx'
import { AddSoundMenu } from './components/AddSoundMenu.jsx'
import { mountPresetPill, setPresetPillPreset } from './presetPill.js'

// The app-wide top bar. Each piece of its state has one owner that pushes it
// in (the Mixer: preset, playing, volume, mute, "+" menu; core/SleepTimer.js:
// the countdown; main.js: the DEV badge), and each owner registers the
// handlers for its own buttons. Both work before mountToolbar() runs - the
// Mixer's module body calls them at import time.

let state = INITIAL_TOOLBAR_STATE
const handlers = {}
// Looked up at click time, so a handler registered after mount still works.
const handlerProxy = new Proxy(handlers, {
  get: (target, name) => (...args) => target[name]?.(...args)
})
let root = null
let navRoot = null

function render() {
  if (!root) return
  flushSync(() => root.render(<Toolbar state={state} handlers={handlerProxy} />))
}

// headerEl is the media bar at the bottom; navEndEl is the right end of the
// top nav (Settings); pillEl is the title bar's center (the preset pill).
export function mountToolbar(headerEl, navEndEl, pillEl) {
  root = createRoot(headerEl)
  render()
  mountPresetPill(pillEl, {
    onOpen: () => handlerProxy.onOpenPresets(),
    onSave: () => handlerProxy.onPillSave(),
    onCancel: () => handlerProxy.onPillCancel()
  })
  setPresetPillPreset(state.presetName, state.mixCount)
  navRoot = createRoot(navEndEl)
  renderNav()
}

let settingsOpen = false
function renderNav() {
  navRoot?.render(<NavEnd handlers={handlerProxy} settingsOpen={settingsOpen} />)
}

// main.js pushes whether the Settings page is the active tab.
export function setSettingsOpen(open) {
  settingsOpen = open
  renderNav()
}

// The "Add sound" button + menu live in the Mixer's own toolbar row.
export function mountAddSound(slotEl) {
  createRoot(slotEl).render(<AddSoundMenu onPick={(id) => handlerProxy.onAddSound(id)} />)
}

export function updateToolbar(patch) {
  state = { ...state, ...patch }
  render()
  if ('presetName' in patch || 'mixCount' in patch) setPresetPillPreset(state.presetName, state.mixCount)
}

export function setToolbarHandlers(patch) {
  Object.assign(handlers, patch)
}
