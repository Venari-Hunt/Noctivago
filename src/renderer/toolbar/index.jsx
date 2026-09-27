import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { INITIAL_TOOLBAR_STATE } from './domain/toolbar.js'
import { Toolbar } from './components/Toolbar.jsx'

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

function render() {
  if (!root) return
  flushSync(() => root.render(<Toolbar state={state} handlers={handlerProxy} />))
}

export function mountToolbar(headerEl) {
  root = createRoot(headerEl)
  render()
}

export function updateToolbar(patch) {
  state = { ...state, ...patch }
  render()
}

export function setToolbarHandlers(patch) {
  Object.assign(handlers, patch)
}
