import { VolumeKnob, playTypeOf } from './VolumeKnob.jsx'
import { MuteIcon, VolumeIcon } from '../../../components/icons.jsx'
import { MockIcon } from '../../../components/mockIcons.jsx'

// Desktop 2.0 step 18 (mock screen "missing"): the file is gone, so the card
// says so and offers the fix (Find file relinks) or Remove (with Undo).
export function MissingControls({ onRelink, onRemove }) {
  return (
    <div className="sound-row-controls-missing">
      <button type="button" className="btn btn-icon-text" onClick={onRelink}>
        <MockIcon name="link" /> Find file
      </button>
      <button type="button" className="btn btn-ghost" onClick={onRemove}>
        Remove
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
