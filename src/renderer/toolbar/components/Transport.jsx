import { MoonIcon, MuteIcon, PauseAllIcon, PlayAllIcon, VolumeIcon } from '../../components/icons.jsx'
import { muteButtonTitle, playButtonTitle, sleepButtonTitle } from '../domain/toolbar.js'
import { GlobalVolume } from './GlobalVolume.jsx'

export function Transport({ state, handlers }) {
  return (
    <div className="toolbar-group toolbar-transport">
      <button className="btn btn-primary btn-svg-icon" type="button" title={playButtonTitle(state.playing)} onClick={handlers.onPlayPause}>
        {state.playing ? <PauseAllIcon /> : <PlayAllIcon />}
      </button>
      <GlobalVolume gain={state.volumeGain} onInput={handlers.onVolumeInput} />
      <button
        className={'btn btn-svg-icon' + (state.muted ? ' btn-svg-icon-active' : '')}
        type="button"
        title={muteButtonTitle(state.muted)}
        onClick={handlers.onMuteToggle}
      >
        {state.muted ? <MuteIcon size={16} /> : <VolumeIcon size={16} />}
      </button>
      <div className="sleep-timer-wrapper">
        <button
          className={'btn btn-svg-icon' + (state.sleepActive ? ' btn-svg-icon-active' : '')}
          type="button"
          title={sleepButtonTitle(state.sleepActive)}
          onClick={handlers.onOpenSleepTimer}
        >
          <MoonIcon />
        </button>
        {state.sleepActive && (
          <span className="sleep-timer-remaining" onClick={handlers.onOpenSleepTimer}>
            {state.sleepRemaining}
          </span>
        )}
      </div>
    </div>
  )
}
