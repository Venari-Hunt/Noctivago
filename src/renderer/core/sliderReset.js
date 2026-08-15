// App-wide UI convention: double-clicking any <input type="range"> resets it
// to its untampered default, using the element's native `defaultValue` (the
// value it was given in markup, distinct from its live `value`) rather than
// each slider hand-wiring its own reset handler. One delegated listener on
// the document catches every slider anywhere in the app - core or any
// plugin's rendered tab - with zero code required on the slider's side
// beyond giving it a sensible default `value` when it's created.
export function installSliderDoubleClickReset() {
  document.addEventListener('dblclick', (evt) => {
    const el = evt.target
    if (!(el instanceof HTMLInputElement) || el.type !== 'range') return
    el.value = el.defaultValue
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
