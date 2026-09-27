import { VolumeSlider } from './VolumeSlider.jsx'
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

// In Mix / volume / level meter / mute / solo, one grid row (main.css).
export function SoundControls({ id, state, callbacks }) {
  const { included, loading, volume, muted, soloed } = state
  return (
    <div className="sound-row-controls">
      <button
        type="button"
        className={'btn btn-small' + (included ? ' btn-active' : '')}
        disabled={loading}
        onClick={() => callbacks.onToggleIncluded(id)}
      >
        {loading ? 'Loading…' : included ? 'In Mix' : 'Add'}
      </button>
      <VolumeSlider volume={volume} onChange={(gain) => callbacks.onVolumeChange(id, gain)} />
      {/* Painted by ui/levelMeters.js, outside React. */}
      <span className="level-meter" data-meter-sound={id}>
        <span className="level-meter-fill" />
      </span>
      <button
        type="button"
        className={'btn btn-svg-icon' + (muted ? ' btn-svg-icon-active' : '')}
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => callbacks.onToggleMute(id)}
      >
        {muted ? <MuteIcon /> : <VolumeIcon />}
      </button>
      {/* "S" like a DAW's solo button. Accent when active, not the mute red:
          soloed means audible on purpose. */}
      <button
        type="button"
        className={'btn btn-svg-icon sound-row-solo' + (soloed ? ' btn-svg-icon-solo-active' : '')}
        title={soloed ? 'Unsolo' : 'Solo (mute every other sound)'}
        onClick={() => callbacks.onToggleSolo(id)}
      >
        S
      </button>
    </div>
  )
}
