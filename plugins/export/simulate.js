// Duplicated from src/renderer/audio/ScatterSoundSource.js and
// ScheduledSoundSource.js - a plugin can't import files outside its own
// directory (enforced by the plugin:// path-traversal guard), so this
// mirrors the Remix plugin's own established "bundle your own dependencies"
// pattern rather than fighting the sandboxing model. Keep these three
// functions in sync with their originals if the randomization/scheduling
// math there ever changes.
const DEFAULT_PITCH_RANGE_SEMITONES = 12
const DEFAULT_MIN_GAP_SECONDS = 5
const DEFAULT_MAX_GAP_SECONDS = 35

function randomGapSeconds(scatter) {
  const min = Math.max(0, scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS)
  const max = Math.max(min, scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS)
  return min + Math.random() * (max - min)
}

function randomPitchSemitones(scatter) {
  let min = scatter?.minPitchSemitones ?? 0
  let max = scatter?.maxPitchSemitones ?? 0
  if (min === 0 && max === 0) {
    min = -DEFAULT_PITCH_RANGE_SEMITONES
    max = DEFAULT_PITCH_RANGE_SEMITONES
  }
  if (max < min) max = min
  return min + Math.random() * (max - min)
}

function randomVolumeScale(scatter) {
  const min = Math.max(0, scatter?.minVolume ?? 1)
  const max = Math.max(min, scatter?.maxVolume ?? 1)
  return min + Math.random() * (max - min)
}

function secondsUntilNextTrigger(schedule, now) {
  if (!schedule) return null
  if (schedule.type === 'interval') {
    const intervalMs = Math.max(1, schedule.intervalMinutes ?? 60) * 60000
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msSinceMidnight = now.getTime() - startOfDay
    const msUntilNext = intervalMs - (msSinceMidnight % intervalMs)
    return msUntilNext / 1000
  }
  const times = schedule.times ?? []
  if (times.length === 0) return null
  const candidates = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return d.getTime()
    })
    .filter((t) => t !== null)
  if (candidates.length === 0) return null
  return (Math.min(...candidates) - now.getTime()) / 1000
}

// Rolls randomGapSeconds repeatedly (the exact same function a live scatter
// source uses to schedule its next shot) until the cumulative offset would
// exceed durationSeconds - a dry run of the same process, no audio
// scheduling involved. Each event carries the sound's own trimmed shot
// duration (loopEnd - loopStart, pitch-adjusted the same way
// ScatterSoundSource.js's real fade-envelope math already accounts for) so
// exportMix.js can land a fade-out at the shot's real end.
function simulateScatterEvents(entry, durationSeconds) {
  const scatter = entry.scatter ?? {}
  const nominalShotDuration = Math.max(0, (entry.loopEnd ?? 0) - (entry.loopStart ?? 0))
  const events = []
  let offset = 0
  while (offset < durationSeconds) {
    const pitchSemitones = randomPitchSemitones(scatter)
    const effectiveRate = Math.pow(2, pitchSemitones / 12)
    events.push({
      offsetSeconds: offset,
      pitchSemitones,
      volumeScale: randomVolumeScale(scatter),
      fadeInMs: scatter.fadeInMs ?? 0,
      fadeOutMs: scatter.fadeOutMs ?? 0,
      shotDurationSeconds: nominalShotDuration / effectiveRate
    })
    offset += randomGapSeconds(scatter)
  }
  return events
}

// Rolls secondsUntilNextTrigger repeatedly starting from the real current
// wall-clock time - per the owner's own explicit instruction ("treat it as
// a sound with timed intervals; if the event falls out of the time scope
// just exclude it from the export"), a 'times' (fixed daily HH:MM) schedule
// simply gets however many of its own real trigger moments happen to land
// within [now, now + durationSeconds); one that wouldn't recur until after
// the export window ends is naturally excluded, not specially handled -
// this loop already stops the instant an offset would exceed
// durationSeconds. 'interval' schedules recur densely enough that this
// distinction rarely matters in practice.
function simulateScheduledEvents(entry, durationSeconds, now) {
  const schedule = entry.schedule ?? {}
  // Per direct owner request, a scheduled trigger's own character is
  // randomized exactly the same way a scatter shot's is - only the *timing*
  // stays deterministic. Reuses the same nominal-shot-duration/pitch-rate
  // math simulateScatterEvents uses, so exportMix.js's fade-out (which
  // needs a real, finite shot duration) works correctly here too.
  const nominalShotDuration = Math.max(0, (entry.loopEnd ?? 0) - (entry.loopStart ?? 0))
  const events = []
  let cursor = new Date(now)
  let offset = 0
  while (true) {
    const seconds = secondsUntilNextTrigger(schedule, cursor)
    if (seconds === null) break
    offset += seconds
    if (offset >= durationSeconds) break
    const pitchSemitones = randomPitchSemitones(schedule)
    const effectiveRate = Math.pow(2, pitchSemitones / 12)
    events.push({
      offsetSeconds: offset,
      pitchSemitones,
      volumeScale: randomVolumeScale(schedule),
      fadeInMs: schedule.fadeInMs ?? 0,
      fadeOutMs: schedule.fadeOutMs ?? 0,
      shotDurationSeconds: nominalShotDuration / effectiveRate
    })
    cursor = new Date(cursor.getTime() + seconds * 1000)
  }
  return events
}

// The extensibility contract the owner explicitly asked for: each playMode
// gets one function producing a plain event list for a given export
// duration, dispatched here by name rather than the export pipeline itself
// knowing scatter/scheduled-specific logic inline. A future playMode only
// needs a case here (or, if this ever grows enough playModes to be worth
// it, a lookup table) to slot into export automatically - 'loop' returns
// null deliberately, since a looped sound has no discrete events at all
// (exportMix.js tiles it directly instead).
export function simulateEvents({ entry, durationSeconds, now = new Date() }) {
  const playMode = entry.playMode ?? 'loop'
  if (playMode === 'scatter') return simulateScatterEvents(entry, durationSeconds)
  if (playMode === 'scheduled') return simulateScheduledEvents(entry, durationSeconds, now)
  return null
}
