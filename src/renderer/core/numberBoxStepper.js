// App-wide UI convention, requested directly with exact rules given: hover a
// number field and scroll (or use Arrow Up/Down while it's focused) to step
// its value - plain +-1, Ctrl +-0.1 (finer), Shift jumps to the next/previous
// multiple of 10, Alt to the next/previous multiple of 100. One delegated
// listener pair on the document, mirroring sliderReset.js's exact pattern -
// zero code required on any number input's side beyond being a real
// <input type="number">, core or any plugin's.
//
// Wheel is deliberately gated on the input already being focused (not just
// hovered): several panels in this app (Remix especially) are themselves
// mouse-wheel-scrollable and now have many number inputs in them (EQ Freq/
// Gain/Q, scatter gap min/max) - reacting to a bare hover-and-scroll-past
// while the user is just trying to scroll the page would turn every one of
// those fields into an accidental value-nudging trap. Requiring a click first
// (which is how every other stepper-by-scroll control works, and matches
// the browser's own native number-input wheel behavior) keeps this additive
// rather than a footgun. Arrow keys need no equivalent guard - a keydown
// event only ever targets whatever's already focused.
const FINE_STEP = 0.1
const PLAIN_STEP = 1
const TEN_MULTIPLE = 10
const HUNDRED_MULTIPLE = 100

// direction > 0 rounds UP to the next multiple strictly above value (3 -> 10
// at multiple 10; 13 -> 100 at multiple 100 - the user's own examples);
// direction < 0 mirrors that downward (13 -> 10; 10 -> 0).
function nextMultiple(value, multiple, direction) {
  if (direction > 0) return (Math.floor(value / multiple) + 1) * multiple
  return (Math.ceil(value / multiple) - 1) * multiple
}

function computeNewValue(current, direction, evt) {
  let next
  if (evt.altKey) next = nextMultiple(current, HUNDRED_MULTIPLE, direction)
  else if (evt.shiftKey) next = nextMultiple(current, TEN_MULTIPLE, direction)
  else if (evt.ctrlKey) next = current + direction * FINE_STEP
  else next = current + direction * PLAIN_STEP
  // Kills float drift (e.g. repeated +-0.1 steps) without forcing away a
  // field's own legitimate fractional value.
  return Math.round(next * 1000) / 1000
}

function clamp(value, input) {
  if (input.min !== '') value = Math.max(value, Number(input.min))
  if (input.max !== '') value = Math.min(value, Number(input.max))
  return value
}

function applyStep(input, direction, evt) {
  const current = Number(input.value) || 0
  input.value = String(clamp(computeNewValue(current, direction, evt), input))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export function installNumberBoxStepper() {
  document.addEventListener(
    'wheel',
    (evt) => {
      const el = document.activeElement
      if (!(el instanceof HTMLInputElement) || el.type !== 'number') return
      if (evt.target !== el) return
      evt.preventDefault()
      applyStep(el, evt.deltaY < 0 ? 1 : -1, evt)
    },
    { passive: false }
  )

  document.addEventListener('keydown', (evt) => {
    if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return
    const el = evt.target
    if (!(el instanceof HTMLInputElement) || el.type !== 'number') return
    evt.preventDefault()
    applyStep(el, evt.key === 'ArrowUp' ? 1 : -1, evt)
  })
}
