// Sleep timer wheel math (pure), ported from the Rouse "How long before"
// wheel (design system `.roller`, mock-rouse-how-long): two fields, hours and
// minutes, and one wheel that rolls whichever field is active.

export const TIMER_MAX_MIN = 1440
export const WHEEL_PX = 10 // finger distance per tick
export const RIDGE_PX = 12 // ridge spacing at the wheel's center

// Any minutes value -> a whole, valid timer length (1 minute to 24 hours).
export function clampMinutes(minutes) {
  const n = Math.round(Number(minutes))
  if (!Number.isFinite(n)) return 1
  return Math.min(TIMER_MAX_MIN, Math.max(1, n))
}

export function splitMinutes(minutes) {
  const m = clampMinutes(minutes)
  return { h: Math.floor(m / 60), min: m % 60 }
}

// One wheel tick on the active unit ('h' or 'min'). Filling the minutes
// moves the wheel to hours; emptying the hours moves it back to minutes.
// Returns { minutes, unit } or null when the wheel is at an end (1 min / 24 h).
export function roll(minutes, unit, up) {
  const m = clampMinutes(minutes)
  const step = unit === 'h' ? 60 : 1
  const next = m + (up ? step : -step)
  if (next < 1 || next > TIMER_MAX_MIN) return null
  let nextUnit = unit
  if (up && unit === 'min' && next % 60 === 0) nextUnit = 'h'
  if (!up && unit === 'h' && next < 60) nextUnit = 'min'
  return { minutes: next, unit: nextUnit }
}

// "2", "0.5", "1,5" -> number; "" -> 0; anything else -> null.
export function readNumber(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (t === '') return 0
  return /^\d*\.?\d+$/.test(t) || /^\d+\.$/.test(t) ? Number(t) : null
}

// The two typed fields -> minutes (hours may be a fraction, minutes may pass 59), or null if either is not a number.
export function minutesFromFields(hText, minText) {
  const h = readNumber(hText)
  const min = readNumber(minText)
  if (h === null || min === null) return null
  return clampMinutes(h * 60 + min)
}

// Clock time ("HH:MM") the timer ends at when it runs for `minutes` from `now`.
export function endClock(minutes, now = new Date()) {
  const end = new Date(now.getTime() + clampMinutes(minutes) * 60000)
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
}

// Side-scroll (or Shift+wheel) over the wheel -> +1 / -1 tick, or 0 for a plain up/down wheel.
export function wheelDirection({ deltaX = 0, deltaY = 0, shiftKey = false }) {
  const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : shiftKey ? deltaY : 0
  return Math.sign(d)
}

export const PRESETS = [
  ['15m', 15],
  ['30m', 30],
  ['45m', 45],
  ['1h', 60],
  ['1h 30m', 90],
  ['2h', 120]
]

export const ACTION_THEN = {
  stop: 'stop sounds',
  displays: 'turn displays off',
  sleep: 'sleep the PC',
  shutdown: 'shut down the PC'
}
