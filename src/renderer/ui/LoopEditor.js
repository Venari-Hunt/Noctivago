import { drawWaveform } from '../audio/waveform.js'

const HANDLE_HIT_PX = 8
const MIN_LOOP_SECONDS = 0.05

export function createLoopEditorController(canvas) {
  let duration = 0
  let loopStart = 0
  let loopEnd = 0
  let dragging = null
  let onChange = () => {}

  function xToTime(x) {
    const t = (x / canvas.width) * duration
    return Math.min(Math.max(t, 0), duration)
  }

  function timeToX(t) {
    return (t / duration) * canvas.width
  }

  function redraw() {
    drawWaveform(canvas, duration, { loopStart, loopEnd })
  }

  function pointerDown(evt) {
    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left
    const startX = timeToX(loopStart)
    const endX = timeToX(loopEnd)
    if (Math.abs(x - startX) <= HANDLE_HIT_PX) dragging = 'start'
    else if (Math.abs(x - endX) <= HANDLE_HIT_PX) dragging = 'end'
  }

  function pointerMove(evt) {
    if (!dragging || !duration) return
    const rect = canvas.getBoundingClientRect()
    const t = xToTime(evt.clientX - rect.left)
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
      redraw()
    },
    getLoopPoints() {
      return { loopStart, loopEnd }
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
