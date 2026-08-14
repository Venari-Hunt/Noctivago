import { drawWaveform } from '../audio/waveform.js'

const HANDLE_HIT_PX = 8
const SNAP_PX = 12
const MIN_LOOP_SECONDS = 0.05

export function createLoopEditorController(canvas) {
  let duration = 0
  let loopStart = 0
  let loopEnd = 0
  let playhead = null
  let dragging = null
  let onChange = () => {}
  let onScrub = () => {}

  function xToTime(x, displayWidth) {
    const t = (x / displayWidth) * duration
    return Math.min(Math.max(t, 0), duration)
  }

  function timeToX(t, displayWidth) {
    return (t / duration) * displayWidth
  }

  function redraw() {
    drawWaveform(canvas, duration, { loopStart, loopEnd, playhead })
  }

  // If a dragged start/end handle ends up within SNAP_PX of the playhead,
  // snap it exactly onto the playhead's time instead of the raw drag position.
  function snapToPlayhead(t, rect) {
    if (playhead == null) return t
    const dist = Math.abs(timeToX(t, rect.width) - timeToX(playhead, rect.width))
    return dist <= SNAP_PX ? playhead : t
  }

  function pointerDown(evt) {
    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left
    const candidates = [
      { type: 'start', dist: Math.abs(x - timeToX(loopStart, rect.width)) },
      { type: 'end', dist: Math.abs(x - timeToX(loopEnd, rect.width)) }
    ]
    if (playhead != null) {
      candidates.push({ type: 'playhead', dist: Math.abs(x - timeToX(playhead, rect.width)) })
    }
    const closest = candidates.reduce((a, b) => (a.dist <= b.dist ? a : b))
    if (closest.dist <= HANDLE_HIT_PX) dragging = closest.type
  }

  function pointerMove(evt) {
    if (!dragging || !duration) return
    const rect = canvas.getBoundingClientRect()
    const t = xToTime(evt.clientX - rect.left, rect.width)

    if (dragging === 'start') {
      loopStart = Math.min(snapToPlayhead(t, rect), loopEnd - MIN_LOOP_SECONDS)
      redraw()
      onChange({ loopStart, loopEnd })
    } else if (dragging === 'end') {
      loopEnd = Math.max(snapToPlayhead(t, rect), loopStart + MIN_LOOP_SECONDS)
      redraw()
      onChange({ loopStart, loopEnd })
    } else if (dragging === 'playhead') {
      playhead = t
      redraw()
      onScrub(t)
    }
  }

  function pointerUp() {
    dragging = null
  }

  canvas.addEventListener('mousedown', pointerDown)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)

  return {
    load(totalDuration, initialLoopStart, initialLoopEnd) {
      duration = totalDuration
      loopStart = initialLoopStart ?? 0
      loopEnd = initialLoopEnd ?? totalDuration
      playhead = null
      redraw()
    },
    getLoopPoints() {
      return { loopStart, loopEnd }
    },
    setLoopPoints(newStart, newEnd) {
      loopStart = Math.min(Math.max(newStart, 0), duration)
      loopEnd = Math.min(Math.max(newEnd, loopStart + MIN_LOOP_SECONDS), duration)
      redraw()
      onChange({ loopStart, loopEnd })
    },
    setPlayhead(t) {
      playhead = t
      redraw()
    },
    clearPlayhead() {
      playhead = null
      redraw()
    },
    onLoopChange(fn) {
      onChange = fn
    },
    onScrub(fn) {
      onScrub = fn
    },
    destroy() {
      canvas.removeEventListener('mousedown', pointerDown)
      window.removeEventListener('mousemove', pointerMove)
      window.removeEventListener('mouseup', pointerUp)
    }
  }
}
