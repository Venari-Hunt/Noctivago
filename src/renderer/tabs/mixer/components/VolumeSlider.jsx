import { useEffect, useLayoutEffect, useRef } from 'react'
import { gainToSlider, sliderToGain, DEFAULT_VOLUME, SLIDER_STEPS } from '../../../../shared/volumeScale.js'
import { DRAG_THRESHOLD_PX, dragPosition } from '../domain/soundRow.js'

// Bipolar: the centre is unity gain (shared/volumeScale.js). Uncontrolled
// on purpose - the Mixer doesn't re-render while dragging, and a controlled
// input would snap back. The native listener (not onChange) also catches the
// app-wide double-click reset (core/sliderReset.js), which sets .value and
// dispatches `input` itself; React's change tracking swallows that event.
// defaultValue is the reset target, value is the live volume. onMove (optional)
// hears the gain on every render and every drag step, for a knob that mirrors it.
export function VolumeSlider({ label, volume, onChange, onMove }) {
  const ref = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  // Every render, not only when `volume` changes: a drag doesn't re-render,
  // so the last rendered volume can be stale, and setting it back to that
  // value (the menu's Reset volume) must still move the thumb.
  useLayoutEffect(() => {
    const target = String(gainToSlider(volume))
    if (ref.current.value !== target) ref.current.value = target
    onMoveRef.current?.(volume)
  })

  useEffect(() => {
    const el = ref.current
    const onInput = () => {
      const gain = sliderToGain(el.value)
      onMoveRef.current?.(gain)
      onChangeRef.current(gain)
    }
    el.addEventListener('input', onInput)

    // Drag the knob sideways (a press without a drag is a click, which
    // belongs to the card). The native thumb jump is cancelled so a click
    // never changes the volume; arrow keys and double-click reset still work.
    let drag = null
    const onDown = (evt) => {
      if (evt.button !== 0) return
      evt.preventDefault()
      el.focus({ preventScroll: true })
      drag = { id: evt.pointerId, x: evt.clientX, from: Number(el.value) / SLIDER_STEPS, moved: false }
    }
    const onMovePtr = (evt) => {
      if (!drag || evt.pointerId !== drag.id) return
      const dx = evt.clientX - drag.x
      if (!drag.moved) {
        if (Math.abs(dx) <= DRAG_THRESHOLD_PX) return
        drag.moved = true
        el.setPointerCapture(drag.id)
      }
      el.value = String(Math.round(dragPosition(drag.from, dx) * SLIDER_STEPS))
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const onUp = (evt) => {
      if (!drag || evt.pointerId !== drag.id) return
      if (drag.moved) {
        // A drag must not also flip the card in or out of the mix.
        const swallow = (e) => {
          e.stopPropagation()
          e.preventDefault()
        }
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      }
      drag = null
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMovePtr)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMovePtr)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // The wrapper carries the centre-tick marker (::after).
  return (
    <span className="volume-slider-wrap">
      <input ref={ref} type="range" min="0" max={SLIDER_STEPS} className="sound-row-volume" aria-label={label || 'Volume'} defaultValue={gainToSlider(DEFAULT_VOLUME)} />
    </span>
  )
}
