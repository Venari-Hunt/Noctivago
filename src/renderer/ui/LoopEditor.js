import { drawWaveform } from '../audio/waveform.js'

const HANDLE_HIT_PX = 8
const MIN_LOOP_SECONDS = 0.05

export function createLoopEditorController(canvas) {
  let duration = 0
  let loopStart = 0
  let loopEnd = 0
  let playhead = null
  let dragging = null
  let onChange = () => {}

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

  function pointerDown(evt) {
    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left
    const startX = timeToX(loopStart, rect.width)
    const endX = timeToX(loopEnd, rect.width)
    if (Math.abs(x - startX) <= HANDLE_HIT_PX) dragging = 'start'
    else if (Math.abs(x - endX) <= HANDLE_HIT_PX) dragging = 'end'
  }

  function pointerMove(evt) {
    if (!dragging || !duration) return
    const rect = canvas.getBoundingClientRect()
    const t = xToTime(evt.clientX - rect.left, rect.width)
    if (dragging === 'start') loopStart = Math.min(t, loopEnd - MIN_LOOP_SECONDS)
    else loopEnd = Math.max(t, loopStart + MIN_LOOP_SECONDS)
    redraw()
    onChange({ loopStart, loopEnd })
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
    destroy() {
      canvas.removeEventListener('mousedown', pointerDown)
      window.removeEventListener('mousemove', pointerMove)
      window.removeEventListener('mouseup', pointerUp)
    }
  }
}
