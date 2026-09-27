import { useEffect, useLayoutEffect, useRef } from 'react'
import { gainToSlider, sliderToGain, DEFAULT_VOLUME, SLIDER_STEPS } from '../../../core/volumeScale.js'

// Bipolar: the centre is unity gain (core/volumeScale.js). Uncontrolled
// on purpose - the Mixer doesn't re-render while dragging, and a controlled
// input would snap back. The native listener (not onChange) also catches the
// app-wide double-click reset (core/sliderReset.js), which sets .value and
// dispatches `input` itself; React's change tracking swallows that event.
// defaultValue is the reset target, value is the live volume.
export function VolumeSlider({ volume, onChange }) {
  const ref = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Every render, not only when `volume` changes: a drag doesn't re-render,
  // so the last rendered volume can be stale, and setting it back to that
  // value (the menu's Reset volume) must still move the thumb.
  useLayoutEffect(() => {
    const target = String(gainToSlider(volume))
    if (ref.current.value !== target) ref.current.value = target
  })

  useEffect(() => {
    const el = ref.current
    const onInput = () => onChangeRef.current(sliderToGain(el.value))
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
