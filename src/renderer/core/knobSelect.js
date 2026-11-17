// One wheel rule for every knob, the Mixer's and every plugin's (owner,
// 2026-11-14): click a knob to select it, then the plain wheel turns it. An
// unselected knob lets the wheel scroll the panel. Click elsewhere or Esc
// unselects; drag and arrow keys work as before.
//
// A knob is any element with a `data-knob` attribute holding a range input.
// "Selected" is the knob holding the focus (clicking or dragging focuses its
// input, Tab does too), so it needs no state of its own: CSS draws it with
// :focus-within. One delegated listener on the document, like
// numberBoxStepper.js, so a plugin's knob only needs the attribute.

export const KNOB_SELECTOR = '[data-knob]'

// 30 px of wheel is one percent of the travel (a mouse notch is 100 px, so
// about 3%); never less than one step, so a coarse knob still moves. Ctrl
// moves exactly one step for fine control. Lines count as 40 px.
export const WHEEL_PX_PER_PERCENT = 30
const COMMIT_DELAY_MS = 250

// Wheel up or right turns the knob up. Pure, so the test runs without a DOM.
export function knobWheelValue({ value, min, max, step }, { deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false }) {
  const lo = Number(min) || 0
  const hi = Number.isFinite(Number(max)) && max !== '' ? Number(max) : 100
  const unit = Number(step) > 0 ? Number(step) : 1
  const px = (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : -deltaY) * (deltaMode === 1 ? 40 : 1)
  const current = Number(value) || 0
  if (!px || !(hi > lo)) return current
  const sign = Math.sign(px)
  const byWheel = ((px / WHEEL_PX_PER_PERCENT) / 100) * (hi - lo)
  const delta = ctrlKey || Math.abs(byWheel) < unit ? sign * unit : byWheel
  const snapped = lo + Math.round((current + delta - lo) / unit) * unit
  return Math.min(hi, Math.max(lo, Number(snapped.toFixed(6))))
}

// React and plugin knobs both listen for 'input'; going through the prototype
// setter is what React's value tracker sees.
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, String(value))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function installKnobSelect() {
  const commits = new WeakMap()
  document.addEventListener(
    'wheel',
    (evt) => {
      if (evt.defaultPrevented || !(evt.target instanceof Element)) return
      const knob = evt.target.closest(KNOB_SELECTOR)
      if (!knob || !knob.contains(document.activeElement)) return
      const input = knob.querySelector('input[type="range"]')
      if (!input || input.disabled) return
      evt.preventDefault()
      const next = knobWheelValue(input, evt)
      if (next === Number(input.value)) return
      setValue(input, next)
      // Undo and save commit on 'change', as at the end of a drag.
      clearTimeout(commits.get(input))
      commits.set(input, setTimeout(() => input.dispatchEvent(new Event('change', { bubbles: true })), COMMIT_DELAY_MS))
    },
    { passive: false }
  )

  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Escape') return
    const el = document.activeElement
    if (el instanceof HTMLElement && el.closest(KNOB_SELECTOR)) el.blur()
  })
}
