// Sleep timer time math, shared by the modal (renderer) and the
// auto-start-on-launch path (main/sleepTimer.js).

// "HH:MM" -> the next Date that matches it (today if still ahead, else
// tomorrow), or null if the string isn't a valid time.
export function targetFromTimeOfDay(hhmm, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const target = new Date(now)
  target.setHours(h, min, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  return target
}

// The remembered prefs ({ sleepTimerMode, sleepTimerMinutes,
// sleepTimerTimeOfDay }) -> seconds until the timer should fire, or null if
// they don't describe a valid timer.
export function durationFromPrefs({ sleepTimerMode, sleepTimerMinutes, sleepTimerTimeOfDay }, now = new Date()) {
  if (sleepTimerMode === 'at') {
    const target = targetFromTimeOfDay(sleepTimerTimeOfDay, now)
    return target ? Math.max(1, Math.round((target.getTime() - now.getTime()) / 1000)) : null
  }
  const minutes = Number(sleepTimerMinutes)
  return Number.isFinite(minutes) && minutes >= 1 ? minutes * 60 : null
}

// Seconds -> "45 minutes" / "2 hours" / "1 h 30 min", for sentences (the
// clock-style formatDuration reads oddly in prose).
export function durationInWords(seconds) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} minute${m === 1 ? '' : 's'}`
  if (m === 0) return `${h} hour${h === 1 ? '' : 's'}`
  return `${h} h ${m} min`
}
