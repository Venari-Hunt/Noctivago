import { MoonIcon, MuteIcon, PauseAllIcon, PlayAllIcon, VolumeIcon } from '../../components/icons.jsx'
import { muteButtonTitle, playButtonTitle, sleepButtonTitle } from '../domain/toolbar.js'
import { GlobalVolume } from './GlobalVolume.jsx'

// Play sits alone in the middle of the player; the rest hangs off its right.
export function Transport({ state, handlers }) {
  return (
    <>
      <button className="btn btn-play" type="button" title={playButtonTitle(state.playing)} onClick={handlers.onPlayPause}>
        {state.playing ? <PauseAllIcon /> : <PlayAllIcon />}
      </button>
      <div className="toolbar-group toolbar-actions">
        {state.sleepActive ? (
          <button className="btn btn-ghost sleep-timer-remaining" type="button" title={sleepButtonTitle(true)} onClick={handlers.onOpenSleepTimer}>
            <MoonIcon />
            {state.sleepRemaining}
          </button>
        ) : (
          <button className="btn btn-ghost btn-svg-icon" type="button" title={sleepButtonTitle(false)} onClick={handlers.onOpenSleepTimer}>
            <MoonIcon />
          </button>
        )}
        <button
          className={'btn btn-ghost btn-svg-icon' + (state.muted ? ' btn-svg-icon-active' : '')}
          type="button"
          title={muteButtonTitle(state.muted)}
          onClick={handlers.onMuteToggle}
        >
          {state.muted ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
        </button>
        <GlobalVolume gain={state.volumeGain} onInput={handlers.onVolumeInput} />
      </div>
    </>
  )
}
