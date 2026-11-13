// App-wide UI convention, requested directly with exact rules given: hover a
// number field and scroll (or use Arrow Up/Down while it's focused) to step
// its value - plain +-1 step, Ctrl +-0.1 step (finer), Shift jumps to the
// next/previous multiple of 10 steps, Alt to the next/previous multiple of
// 100 steps. One delegated listener pair on the document, mirroring
// sliderReset.js's exact pattern - zero code required on any number input's
// side beyond being a real <input type="number">, core or any plugin's.
//
// Wheel triggers on pure hover - a click/focus is NOT required first. This
// was originally gated on focus (see commit b0f6de1-era history) to avoid
// turning every number field into an accidental value-nudging trap while
// scrolling a panel past it (Remix especially has many number inputs -
// EQ Freq/Gain/Q, scatter gap min/max). Reversed per direct, explicit
// feedback ("Just hovering a text box with a number should be grounds for
// scrolling... Not selecting then hovering") - the accidental-nudge risk is
// real but the owner has weighed it and wants hover-only regardless. Arrow
// keys need no equivalent change - a keydown event only ever targets
// whatever's already focused, hover doesn't apply to them.
//
// Content-aware step size, added per direct follow-up feedback ("When i
// scroll for a unit on the q box it is a LOT so this should be adjusting
// depending on what i'm messing with"): the base "one step" unit is read
// from the input's own HTML `step` attribute (already declared per-field -
// EQ Freq is 1, EQ Gain/Q are 0.1, scatter gap fields are 1) rather than a
// single hardcoded 1 for every field regardless of its actual range. A
// hardcoded plain step of 1 on Q (whose entire usable range is 0.1-10) was
// nearly a third of the range per scroll tick - exactly the reported
// problem. Every other tier scales off that same base rather than its own
// separate hardcoded constant, so the whole modifier ladder stays
// proportional to the field: Ctrl is a tenth of the base step, Shift jumps
// to the next multiple of 10x the base step, Alt to the next multiple of
// 100x. Fields whose own step is already 1 (EQ Freq, scatter gap) are
// unaffected - this generalizes the existing behavior, it doesn't replace it.
const TEN_MULTIPLE = 10
const HUNDRED_MULTIPLE = 100

function baseStep(input) {
  const step = Number(input.step)
  return Number.isFinite(step) && step > 0 ? step : 1
}

// direction > 0 rounds UP to the next multiple strictly above value (3 -> 10
// at multiple 10; 13 -> 100 at multiple 100 - the user's own examples);
// direction < 0 mirrors that downward (13 -> 10; 10 -> 0).
function nextMultiple(value, multiple, direction) {
  if (direction > 0) return (Math.floor(value / multiple) + 1) * multiple
  return (Math.ceil(value / multiple) - 1) * multiple
}

function computeNewValue(current, direction, evt, step) {
  let next
  if (evt.altKey) next = nextMultiple(current, step * HUNDRED_MULTIPLE, direction)
  else if (evt.shiftKey) next = nextMultiple(current, step * TEN_MULTIPLE, direction)
  else if (evt.ctrlKey) next = current + direction * (step / TEN_MULTIPLE)
  else next = current + direction * step
  // Kills float drift (e.g. repeated +-0.1 steps) without forcing away a
  // field's own legitimate fractional value.
  return Math.round(next * 1000) / 1000
}

function clamp(value, input) {
  if (input.min !== '') value = Math.max(value, Number(input.min))
  if (input.max !== '') value = Math.min(value, Number(input.max))
  return value
}

// A plain `input.value = x` is invisible to React (its value tracker only sees
// the native setter), so a React onChange would never fire. Go through the
// prototype setter, then fire the same bubbling input event.
function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, String(value))
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function applyStep(input, direction, evt) {
  const current = Number(input.value) || 0
  setValue(input, clamp(computeNewValue(current, direction, evt, baseStep(input)), input))
}

// Sliders and knobs (a knob is an invisible range input): the wheel moves 1%
// of the travel per notch, Ctrl moves one `step` for fine control. Pure, so
// the test can run it without a DOM.
export function rangeWheelValue({ value, min, max, step }, direction, fine) {
  const lo = Number(min) || 0
  const hi = Number(max) || 100
  const unit = Number(step) > 0 ? Number(step) : 1
  const size = fine ? unit : Math.max(unit, (hi - lo) / 100)
  const next = Number(value) + direction * size
  return Math.round(Math.min(hi, Math.max(lo, next)) * 1000) / 1000
}

export function installNumberBoxStepper() {
  document.addEventListener(
    'wheel',
    (evt) => {
      const el = evt.target
      if (!(el instanceof HTMLInputElement) || evt.defaultPrevented) return
      if (el.type === 'range') {
        // Shift+wheel is the Mixer card's side-scroll, which turns its own volume.
        if (el.disabled || evt.shiftKey || !evt.deltaY) return
        evt.preventDefault()
        setValue(el, rangeWheelValue(el, evt.deltaY < 0 ? 1 : -1, evt.ctrlKey))
        return
      }
      if (el.type !== 'number') return
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
