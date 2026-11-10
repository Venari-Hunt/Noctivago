import { useRef } from 'react'
import { gainToPosition } from '../../../../shared/volumeScale.js'
import { ClockIcon, MuteIcon, RepeatIcon, ShuffleIcon } from '../../../components/icons.jsx'
import { VolumeSlider } from './VolumeSlider.jsx'

export const PLAY_TYPES = {
  loop: { label: 'Loop', Icon: RepeatIcon },
  random: { label: 'Random', Icon: ShuffleIcon },
  scheduled: { label: 'Scheduled', Icon: ClockIcon }
}

// The stored playMode says 'scatter' for Random Interval; anything else that
// is not scheduled loops.
export function playTypeOf(entry) {
  if (entry.playMode === 'scatter') return 'random'
  if (entry.playMode === 'scheduled') return 'scheduled'
  return 'loop'
}

function formatPercent(gain) {
  const pct = gain * 100
  return (pct > 0 && pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) + '%'
}

// A 270-degree arc (100% is the mark at the top) over the old slider: the
// range input stays the one source of truth and sits invisible on top of the
// ring, so a horizontal drag still sets the volume. The arc and the percent
// follow it through onMove, without a React re-render (the Mixer doesn't
// re-render while dragging).
export function VolumeKnob({ volume, muted, playType, onChange }) {
  const ringRef = useRef(null)
  const pctRef = useRef(null)
  const { Icon } = PLAY_TYPES[playType]
  const onMove = (gain) => {
    ringRef.current?.style.setProperty('--p', String(gainToPosition(gain) * 100))
    if (pctRef.current) pctRef.current.textContent = formatPercent(gain)
  }
  return (
    <div className="knob" ref={ringRef}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="knob-track" cx="36" cy="36" r="31" pathLength="100" />
        <circle className="knob-value" cx="36" cy="36" r="31" pathLength="100" />
      </svg>
      <i className="knob-unity" />
      <span className="knob-mid">{muted ? <MuteIcon size={24} /> : <Icon size={24} />}</span>
      <span className="knob-pct" ref={pctRef}>{formatPercent(volume)}</span>
      <VolumeSlider volume={volume} onChange={onChange} onMove={onMove} />
    </div>
  )
}
