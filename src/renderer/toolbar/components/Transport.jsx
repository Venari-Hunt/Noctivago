import { MockIcon } from '../../components/mockIcons.jsx'
import { muteButtonTitle, playButtonTitle, sleepButtonTitle } from '../domain/toolbar.js'
import { GlobalVolume } from './GlobalVolume.jsx'

// Play sits alone in the middle of the media bar; the rest hangs off its right.
export function Transport({ state, handlers }) {
  return (
    <>
      <button className="btn btn-play" type="button" title={playButtonTitle(state.playing)} onClick={handlers.onPlayPause}>
        <MockIcon name={state.playing ? 'pause' : 'play'} size={20} />
      </button>
      <div className="toolbar-group toolbar-actions">
        {state.sleepActive ? (
          // Running: the moon turns amber and an amber ring round it closes as the time runs out
          // (owner, 2026-11-21: the ring is the only sign of time left; the tooltip has the number).
          <button
            id="sleep-timer-button"
            className={'btn btn-ghost btn-svg-icon sleep-running' + (state.sleepOpen ? ' sleep-open' : '')}
            type="button"
            title={sleepButtonTitle(true, state.sleepRemaining)}
            aria-label={sleepButtonTitle(true, state.sleepRemaining)}
            onClick={handlers.onOpenSleepTimer}
          >
            <MockIcon name="moon" size={20} />
            <svg className="sleep-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle className="v" cx="20" cy="20" r="18" pathLength="100" style={{ strokeDashoffset: 100 - state.sleepPercent }} />
            </svg>
          </button>
        ) : (
          <button id="sleep-timer-button" className={'btn btn-ghost btn-svg-icon' + (state.sleepOpen ? ' sleep-open' : '')} type="button" title={sleepButtonTitle(false)} onClick={handlers.onOpenSleepTimer}>
            <MockIcon name="moon" size={20} />
          </button>
        )}
        <button
          className={'btn btn-ghost btn-svg-icon' + (state.muted ? ' btn-svg-icon-active' : '')}
          type="button"
          title={muteButtonTitle(state.muted)}
          onClick={handlers.onMuteToggle}
        >
          <MockIcon name={state.muted ? 'volume-x' : 'volume-2'} size={20} />
        </button>
        <GlobalVolume gain={state.volumeGain} onInput={handlers.onVolumeInput} />
      </div>
    </>
  )
}
