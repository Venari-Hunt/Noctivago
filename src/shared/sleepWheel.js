// Sleep timer wheel math (pure), ported from the Rouse "How long before"
// wheel (design system `.roller`, mock-rouse-how-long): three typable fields
// (days, hours, minutes) and one wheel that only ever adds or removes minutes.

export const TIMER_MAX_MIN = 365 * 1440 // a year; the wheel rolls days with no smaller limit
export const WHEEL_PX = 10 // finger distance per tick
export const RIDGE_PX = 12 // ridge spacing at the wheel's center

// Any minutes value -> a whole, valid timer length (1 minute to a year).
export function clampMinutes(minutes) {
  const n = Math.round(Number(minutes))
  if (!Number.isFinite(n)) return 1
  return Math.min(TIMER_MAX_MIN, Math.max(1, n))
}

export function splitMinutes(minutes) {
  const m = clampMinutes(minutes)
  return { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60), min: m % 60 }
}

// One wheel tick: always one minute, never another unit (bigger jumps are
// typed). Returns the new minutes, or null at an end (1 minute / the cap).
export function roll(minutes, up) {
  const next = clampMinutes(minutes) + (up ? 1 : -1)
  return next < 1 || next > TIMER_MAX_MIN ? null : next
}

// "2", "0.5", "1,5" -> number; "" -> 0; anything else -> null.
export function readNumber(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (t === '') return 0
  return /^\d*\.?\d+$/.test(t) || /^\d+\.$/.test(t) ? Number(t) : null
}

// The three typed fields -> minutes (days and hours may be fractions, minutes may pass 59), or null if any is not a number.
export function minutesFromFields(dText, hText, minText) {
  const d = readNumber(dText)
  const h = readNumber(hText)
  const min = readNumber(minText)
  if (d === null || h === null || min === null) return null
  return clampMinutes(d * 1440 + h * 60 + min)
}

// When the timer ends: "HH:MM" today, "Thu 07:36" on another day.
export function endClock(minutes, now = new Date()) {
  const end = new Date(now.getTime() + clampMinutes(minutes) * 60000)
  const clock = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
  if (end.toDateString() === now.toDateString()) return clock
  const sameWeek = end.getTime() - now.getTime() < 6 * 86400000
  const day = sameWeek ? end.toLocaleDateString('en-US', { weekday: 'short' }) : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day} ${clock}`
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
