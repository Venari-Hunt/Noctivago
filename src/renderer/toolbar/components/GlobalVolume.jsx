import { useEffect, useLayoutEffect, useRef } from 'react'
import { gainToSlider, sliderToGain, SLIDER_STEPS } from '../../core/volumeScale.js'

// Same approach as the sound cards' VolumeSlider: uncontrolled, synced from
// `gain` only when it changes (the startup restore), and listening to the
// native `input` event so the app-wide double-click reset (core/sliderReset.js)
// reaches it. defaultValue (the centre, unity gain) is the reset target.
export function GlobalVolume({ gain, onInput }) {
  const ref = useRef(null)
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useLayoutEffect(() => {
    const target = String(gainToSlider(gain))
    if (ref.current.value !== target) ref.current.value = target
  }, [gain])

  useEffect(() => {
    const el = ref.current
    const handle = () => onInputRef.current(sliderToGain(el.value))
    el.addEventListener('input', handle)
    return () => el.removeEventListener('input', handle)
  }, [])

  return (
    <label className="global-volume-label">
      Volume
      <span className="volume-slider-wrap">
        <input ref={ref} type="range" min="0" max={SLIDER_STEPS} defaultValue={gainToSlider(1)} className="global-volume" />
      </span>
      {/* Filled in every frame by ui/levelMeters.js, outside React. */}
      <span className="level-meter level-meter-master" data-meter-master>
        <span className="level-meter-fill" />
      </span>
    </label>
  )
}
