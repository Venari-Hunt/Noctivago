import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { MockIcon } from '../../../components/mockIcons.jsx'
import { registerAudioOutput } from '../../../core/devAudioOutput.js'
import { formatDuration } from '../../../util/time.js'
import { peekTarget } from '../domain/libraryRail.js'

// The preview at the library rail's foot (owner, 2026-11-13: a compact
// player above Add sound; the center stays only the mix). Same look as
// Remix's preview module: the play disc, the name, then the seek bar with
// its times. It plays the last row hovered or focused; while it plays,
// hovering another row switches to that sound, so you can scan the list by
// ear. It plays the original file (sound://<id>) outside the mix, on its own
// AudioContext that follows the output-device setting.

// Preview volume (owner, 2026-11-16): a slider under the seek bar, 70 % at
// first, remembered in localStorage; the speaker button mutes.
const PREVIEW_GAIN = 0.7
const VOL_KEY = 'noctivago.previewVolume'
function savedVolume() {
  try {
    const v = Number(localStorage.getItem(VOL_KEY))
    return localStorage.getItem(VOL_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : PREVIEW_GAIN
  } catch {
    return PREVIEW_GAIN
  }
}

function createPlayer() {
  let snap = { target: null, playing: false, cur: 0, dur: 0, vol: savedVolume(), muted: false }
  const listeners = new Set()
  const set = (patch) => {
    snap = { ...snap, ...patch }
    for (const fn of listeners) fn()
  }
  let audio = null
  let ctx = null
  let gain = null
  const applyVolume = () => {
    const v = snap.muted ? 0 : snap.vol
    if (gain) gain.gain.value = v
    else if (audio) audio.volume = v
  }

  const ensureAudio = () => {
    if (audio) return audio
    audio = new Audio()
    audio.preload = 'metadata'
    // Without it Chromium treats sound:// as cross-origin and the
    // MediaElementSource below outputs silence (owner, 2026-11-16: no sound).
    audio.crossOrigin = 'anonymous'
    audio.loop = true
    audio.addEventListener('timeupdate', () => set({ cur: audio.currentTime }))
    audio.addEventListener('loadedmetadata', () => set({ dur: Number.isFinite(audio.duration) ? audio.duration : 0 }))
    audio.addEventListener('pause', () => set({ playing: false }))
    audio.addEventListener('play', () => set({ playing: true }))
    audio.addEventListener('error', () => set({ playing: false }))
    try {
      ctx = new AudioContext()
      gain = ctx.createGain()
      ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination)
      registerAudioOutput(ctx)
    } catch {
      ctx = null
      gain = null
    }
    applyVolume()
    return audio
  }

  const load = (id) => {
    const el = ensureAudio()
    el.src = `sound://${id}`
    set({ cur: 0, dur: 0 })
  }

  const play = () => {
    if (!snap.target) return
    const el = ensureAudio()
    if (!el.src) load(snap.target.id)
    ctx?.resume()
    el.play().catch(() => set({ playing: false }))
  }

  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    get: () => snap,
    peek(row) {
      const next = peekTarget(snap.target, row)
      if (next === snap.target) return
      const wasPlaying = snap.playing
      set({ target: next })
      if (wasPlaying) {
        load(next.id)
        play()
      } else if (audio) {
        audio.removeAttribute('src')
        audio.load()
        set({ cur: 0, dur: 0 })
      }
    },
    toggle() {
      if (snap.playing) audio.pause()
      else play()
    },
    // Remix's per-sound play button (group member rows): play this sound from
    // the top, or stop it when it is already the one playing.
    previewSound(row) {
      if (snap.playing && snap.target?.id === row.id) {
        audio.pause()
        return
      }
      set({ target: row })
      load(row.id)
      play()
    },
    setVolume(v) {
      set({ vol: Math.min(1, Math.max(0, v)), muted: false })
      applyVolume()
      try {
        localStorage.setItem(VOL_KEY, String(snap.vol))
      } catch {}
    },
    toggleMute() {
      set({ muted: !snap.muted })
      applyVolume()
    },
    seek(seconds) {
      if (!audio || !snap.dur) return
      audio.currentTime = seconds
      set({ cur: seconds })
    },
    stop() {
      if (audio && snap.playing) audio.pause()
    }
  }
}

function RailPreview({ player }) {
  const { target, playing, cur, dur, vol, muted } = useSyncExternalStore(player.subscribe, player.get)
  const shownVol = muted ? 0 : vol
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0
  return (
    <>
      <div className="mx-prow">
        <button
          type="button"
          className="mx-pplay"
          disabled={!target}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          title={target ? (playing ? 'Pause preview' : 'Hear it before it goes in the mix') : 'Select a sound to preview it'}
          onClick={() => player.toggle()}
        >
          <MockIcon name={playing ? 'pause' : 'play'} />
        </button>
        <span className="mx-now">
          <b>{target ? target.name : 'Preview'}</b>
          <small>{target ? target.meta : 'Select a sound, then press play'}</small>
        </span>
      </div>
      <div className="mx-pseek">
        <span>{formatDuration(cur)}</span>
        <input
          type="range"
          min="0"
          max={dur || 1}
          step="0.1"
          value={cur}
          disabled={!dur}
          aria-label="Preview position"
          style={{ '--p': `${pct}%` }}
          onChange={(e) => player.seek(Number(e.target.value))}
        />
        <span>{dur ? formatDuration(dur) : '0:00'}</span>
      </div>
      <div className="mx-pseek mx-pvol">
        <button type="button" className="mx-pmute" aria-pressed={muted} aria-label={muted ? 'Unmute preview' : 'Mute preview'} title={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => player.toggleMute()}>
          <MockIcon name={shownVol === 0 ? 'volume-x' : 'volume-2'} />
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={shownVol}
          aria-label="Preview volume"
          title={`Preview volume ${Math.round(shownVol * 100)}%`}
          style={{ '--p': `${shownVol * 100}%` }}
          onChange={(e) => player.setVolume(Number(e.target.value))}
        />
      </div>
    </>
  )
}

export function mountRailPreview(el) {
  const player = createPlayer()
  createRoot(el).render(<RailPreview player={player} />)
  return player
}
