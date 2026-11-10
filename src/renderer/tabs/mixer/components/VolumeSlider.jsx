import { useEffect, useLayoutEffect, useRef } from 'react'
import { gainToSlider, sliderToGain, DEFAULT_VOLUME, SLIDER_STEPS } from '../../../../shared/volumeScale.js'

// Bipolar: the centre is unity gain (shared/volumeScale.js). Uncontrolled
// on purpose - the Mixer doesn't re-render while dragging, and a controlled
// input would snap back. The native listener (not onChange) also catches the
// app-wide double-click reset (core/sliderReset.js), which sets .value and
// dispatches `input` itself; React's change tracking swallows that event.
// defaultValue is the reset target, value is the live volume. onMove (optional)
// hears the gain on every render and every drag step, for a knob that mirrors it.
export function VolumeSlider({ volume, onChange, onMove }) {
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
    return () => el.removeEventListener('input', onInput)
  }, [])

  // The wrapper carries the centre-tick marker (::after).
  return (
    <span className="volume-slider-wrap">
      <input ref={ref} type="range" min="0" max={SLIDER_STEPS} className="sound-row-volume" defaultValue={gainToSlider(DEFAULT_VOLUME)} />
    </span>
  )
}
