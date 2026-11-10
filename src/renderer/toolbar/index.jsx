import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { INITIAL_TOOLBAR_STATE } from './domain/toolbar.js'
import { Toolbar } from './components/Toolbar.jsx'
import { NavEnd } from './components/NavEnd.jsx'
import { AddSoundMenu } from './components/AddSoundMenu.jsx'

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

// headerEl is the player bar at the bottom; navEndEl is the right end of the
// top nav (Settings).
export function mountToolbar(headerEl, navEndEl) {
  root = createRoot(headerEl)
  render()
  navRoot = createRoot(navEndEl)
  navRoot.render(<NavEnd handlers={handlerProxy} />)
}

// The "Add sound" button + menu live in the Mixer's own toolbar row.
export function mountAddSound(slotEl) {
  createRoot(slotEl).render(<AddSoundMenu onPick={(id) => handlerProxy.onAddSound(id)} />)
}

export function updateToolbar(patch) {
  state = { ...state, ...patch }
  render()
}

export function setToolbarHandlers(patch) {
  Object.assign(handlers, patch)
}
