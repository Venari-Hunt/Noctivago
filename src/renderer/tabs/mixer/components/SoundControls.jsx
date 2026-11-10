import { VolumeKnob, playTypeOf } from './VolumeKnob.jsx'
import { LinkIcon, MuteIcon, VolumeIcon } from '../../../components/icons.jsx'

export function MissingControls({ onRelink }) {
  return (
    <div className="sound-row-controls-missing">
      <span className="sound-row-missing-label">Missing</span>
      <button type="button" className="btn btn-small btn-icon-text" onClick={onRelink}>
        <LinkIcon /> Relink
      </button>
    </div>
  )
}

// Mute, the volume knob, solo: one centered line (main.css .sound-row-knobs).
// Mute and solo only show on a sound that is in the mix.
export function KnobLine({ entry, state, callbacks }) {
  const { volume, muted, soloed } = state
  const id = entry.id
  return (
    <div className="sound-row-knobs">
      <button
        type="button"
        className={'btn btn-svg-icon sound-row-tool' + (muted ? ' btn-svg-icon-active' : '')}
        title={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        onClick={() => callbacks.onToggleMute(id)}
      >
        {muted ? <MuteIcon /> : <VolumeIcon />}
      </button>
      <VolumeKnob volume={volume} muted={muted} playType={playTypeOf(entry)} onChange={(gain) => callbacks.onVolumeChange(id, gain)} />
      {/* "S" like a DAW's solo button. Accent when active, not the mute red:
          soloed means audible on purpose. */}
      <button
        type="button"
        className={'btn btn-svg-icon sound-row-tool sound-row-solo' + (soloed ? ' btn-svg-icon-solo-active' : '')}
        title={soloed ? 'Unsolo' : 'Solo (mute every other sound)'}
        aria-pressed={soloed}
        onClick={() => callbacks.onToggleSolo(id)}
      >
        S
      </button>
    </div>
  )
}

// The card itself is the in-mix switch (SoundRow's onCardClick). This button
// is the keyboard and screen-reader twin: invisible until focused. Next to it,
// the level meter.
export function MixFoot({ id, state, callbacks }) {
  const { included, loading } = state
  return (
    <div className="sound-row-foot">
      <button
        type="button"
        className="btn btn-small sound-row-switch"
        aria-pressed={included}
        disabled={loading}
        onClick={() => callbacks.onToggleIncluded(id)}
      >
        {loading ? 'Loading…' : included ? 'In Mix' : 'Add'}
      </button>
      {/* Painted by ui/levelMeters.js, outside React. */}
      <span className="level-meter" data-meter-sound={id}>
        <span className="level-meter-fill" />
      </span>
    </div>
  )
}
