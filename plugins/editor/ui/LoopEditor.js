import { drawWaveform } from '../audio/waveform.js'

const HANDLE_HIT_PX = 8
const SNAP_PX = 12
const MIN_LOOP_SECONDS = 0.05
// Floor on how far a scroll-zoom can shrink the visible window - without
// this, zooming keeps halving the span forever with no real detail left to
// show past the peaks array's own fixed resolution (see waveform.js).
const MIN_VIEW_SECONDS = 0.5
const ZOOM_IN_FACTOR = 0.8
const ZOOM_OUT_FACTOR = 1.25

export function createLoopEditorController(canvas) {
  let duration = 0
  let loopStart = 0
  let loopEnd = 0
  let playhead = null
  let peaks = null
  let dragging = null
  let onChange = () => {}
  let onScrub = () => {}

  // The currently visible time window - [0, duration] at full zoom-out.
  // Everything below maps time<->x through this, not through [0, duration]
  // directly, so drag/hit-test/drawing all "just work" once zoomed.
  let viewStart = 0
  let viewEnd = 0

  function xToTime(x, displayWidth) {
    const span = viewEnd - viewStart
    const t = viewStart + (x / displayWidth) * span
    return Math.min(Math.max(t, 0), duration)
  }

  function timeToX(t, displayWidth) {
    const span = viewEnd - viewStart
    return ((t - viewStart) / span) * displayWidth
  }

  function redraw() {
    drawWaveform(canvas, duration, { loopStart, loopEnd, playhead, peaks, viewStart, viewEnd })
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

  // Wheel zoom, centered on the cursor's time position - only active while
  // hovering the canvas, since the listener is attached to the canvas
  // itself rather than window. A horizontal scroll gesture (shift+wheel on
  // a mouse, or a trackpad's two-finger horizontal swipe, both land in
  // deltaX) pans instead of zooming - without some way to pan, zooming in
  // would strand the view on one fixed window with no way to see the rest
  // of the file, which isn't a usable feature on its own.
  function handleWheel(evt) {
    if (!duration) return
    evt.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const span = viewEnd - viewStart

    if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
      const shift = (evt.deltaX / rect.width) * span
      let newStart = viewStart + shift
      let newEnd = viewEnd + shift
      if (newStart < 0) {
        newEnd -= newStart
        newStart = 0
      }
      if (newEnd > duration) {
        newStart -= newEnd - duration
        newEnd = duration
      }
      viewStart = Math.max(newStart, 0)
      viewEnd = Math.min(newEnd, duration)
      redraw()
      return
    }

    const x = evt.clientX - rect.left
    const cursorTime = xToTime(x, rect.width)
    const factor = evt.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR
    const newSpan = Math.min(Math.max(span * factor, MIN_VIEW_SECONDS), duration)

    const ratio = (cursorTime - viewStart) / span
    let newStart = cursorTime - ratio * newSpan
    let newEnd = newStart + newSpan
    if (newStart < 0) {
      newEnd -= newStart
      newStart = 0
    }
    if (newEnd > duration) {
      newStart -= newEnd - duration
      newEnd = duration
    }
    viewStart = Math.max(newStart, 0)
    viewEnd = Math.min(newEnd, duration)
    redraw()
  }

  canvas.addEventListener('mousedown', pointerDown)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })

  return {
    load(totalDuration, initialLoopStart, initialLoopEnd) {
      duration = totalDuration
      loopStart = initialLoopStart ?? 0
      loopEnd = initialLoopEnd ?? totalDuration
      playhead = null
      peaks = null
      viewStart = 0
      viewEnd = totalDuration
      redraw()
    },
    setPeaks(newPeaks) {
      peaks = newPeaks
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
      canvas.removeEventListener('wheel', handleWheel)
    }
  }
}
