// Sleep timer ruler math (pure): minutes on a 0-8 h ruler, the readout
// ("3 h 00"), the clock time the timer ends at, and side-scroll steps.

export const RULER_MAX_MIN = 480
export const RULER_STEP_MIN = 5
export const TIMER_MAX_MIN = 1440

// Any minutes value -> a whole, valid timer length (1 minute to 24 hours).
export function clampMinutes(minutes) {
  const n = Math.round(Number(minutes))
  if (!Number.isFinite(n)) return 1
  return Math.min(TIMER_MAX_MIN, Math.max(1, n))
}

// Ruler thumb position: 0-100 (percent of the track). Past 8 h it pins to the end.
export function rulerPercent(minutes) {
  return (Math.min(RULER_MAX_MIN, Math.max(0, minutes)) / RULER_MAX_MIN) * 100
}

// Dragging the thumb gives a multiple of 5 minutes; the very left end is 1 minute, never 0.
export function minutesFromRuler(value) {
  const v = Math.round(Number(value) / RULER_STEP_MIN) * RULER_STEP_MIN
  return clampMinutes(Math.min(RULER_MAX_MIN, v))
}

// "3 h 00", "0 h 45".
export function readoutText(minutes) {
  const m = clampMinutes(minutes)
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

// Clock time ("HH:MM") the timer ends at when it runs for `minutes` from `now`.
export function endClock(minutes, now = new Date()) {
  const end = new Date(now.getTime() + clampMinutes(minutes) * 60000)
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
}

// Side-scroll (or Shift+wheel) over the ruler -> minutes to add (+/- one step), or 0 for a plain up/down wheel.
export function wheelStep({ deltaX = 0, deltaY = 0, shiftKey = false }) {
  const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : shiftKey ? deltaY : 0
  return d === 0 ? 0 : Math.sign(d) * RULER_STEP_MIN
}

// Next minutes value after a wheel step: snaps to the 5-minute grid first.
export function stepMinutes(minutes, step) {
  if (step === 0) return clampMinutes(minutes)
  const snapped = step > 0 ? Math.floor(minutes / RULER_STEP_MIN) * RULER_STEP_MIN : Math.ceil(minutes / RULER_STEP_MIN) * RULER_STEP_MIN
  return clampMinutes(snapped + step)
}

// "then stop all sounds, at 02:00" for the running state.
export const ACTION_LABELS = {
  stop: 'Stop sounds',
  displays: 'Displays off',
  sleep: 'Sleep PC',
  shutdown: 'Shut down PC'
}
export const ACTION_THEN = {
  stop: 'stop sounds',
  displays: 'turn displays off',
  sleep: 'sleep the PC',
  shutdown: 'shut down the PC'
}

// Typed length -> minutes, or null. Accepts "90", "1:30", "1h30", "1 h 30", "2h", "45m".
export function parseLengthText(text) {
  const t = String(text ?? '').trim().toLowerCase()
  let m
  if ((m = /^(\d+)\s*:\s*(\d{1,2})$/.exec(t))) return clampMinutes(Number(m[1]) * 60 + Number(m[2]))
  if ((m = /^(\d+)\s*h\s*(\d{1,2})$/.exec(t))) return clampMinutes(Number(m[1]) * 60 + Number(m[2]))
  if ((m = /^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(t)) && (m[1] || m[2])) return clampMinutes(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0))
  if ((m = /^(\d+)$/.exec(t))) return clampMinutes(Number(m[1]))
  return null
}
