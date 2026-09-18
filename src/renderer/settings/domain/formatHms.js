// Always shows all three segments, zero-padded (unlike util/time.js's own
// formatDuration, which omits the hour segment entirely when h=0) - matches
// the field's own "hh:mm:ss" placeholder exactly, so what's shown always
// looks like a valid value to re-type from.
export function formatHms(totalSeconds) {
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
