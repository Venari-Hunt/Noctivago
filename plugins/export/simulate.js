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
const FULLY_RANDOM_MAX_GAP_SECONDS = 120

// Duplicated from src/renderer/audio/Modulator.js's pickBiasedValue (same
// cross-directory reason as the file-level comment above) - the "bias"
// value competing with a plain min/max random pick reuses Fluctuation's own
// already-tuned skewed-target math rather than a second distribution.
function pickBiasedValue(min, max, bias) {
  const lower = bias - min
  const upper = max - bias
  const span = lower + upper
  if (span <= 0) return bias
  const goUp = Math.random() < upper / span
  const t = Math.pow(Math.random(), 1.7)
  return goUp ? bias + t * upper : bias - t * lower
}

function randomGapSeconds(scatter) {
  if (scatter?.gapFullyRandom) {
    return Math.random() * FULLY_RANDOM_MAX_GAP_SECONDS
  }
  const min = Math.max(0, scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS)
  const max = Math.max(min, scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS)
  if (scatter?.gapBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.gapBiasSeconds ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

function randomPitchSemitones(scatter) {
  if (scatter?.pitchFullyRandom) {
    return -DEFAULT_PITCH_RANGE_SEMITONES + Math.random() * 2 * DEFAULT_PITCH_RANGE_SEMITONES
  }
  let min = scatter?.minPitchSemitones ?? 0
  let max = scatter?.maxPitchSemitones ?? 0
  if (max < min) max = min
  if (scatter?.pitchBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.pitchBiasSemitones ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

function randomVolumeScale(scatter) {
  const min = Math.max(0, scatter?.minVolume ?? 1)
  const max = Math.max(min, scatter?.maxVolume ?? 1)
  return min + Math.random() * (max - min)
}

// Per-shot wall-clock playback speed multiplier - mirror of
// ScatterSoundSource.js's randomSpeedFactor. 1 = original tempo; both bounds
// at 1 (default) = no variation. exportMix.js applies it pitch-preserved via
// rubberband tempo, and each event's shotDurationSeconds is divided by it so
// the fade-out envelope lands on the shot's real (sped) end.
function randomSpeedFactor(scatter) {
  const min = Math.max(0.1, scatter?.minSpeed ?? 1)
  const max = Math.max(min, scatter?.maxSpeed ?? 1)
  return min + Math.random() * (max - min)
}

// Rolls randomGapSeconds repeatedly (the exact same function a live scatter
// source uses to schedule its next shot) until the cumulative offset would
// exceed durationSeconds - a dry run of the same process, no audio
// scheduling involved. Each event carries the sound's own shot duration:
// the trimmed length (loopEnd - loopStart) divided by that shot's random
// speed factor. A per-shot *pitch* shift is duration-preserving (v0.1.111 -
// live pre-stretches the clip, exportMix.js uses rubberband pitch), but a
// per-shot *speed* change is a deliberate tempo/length change (rubberband
// tempo in the export), so shotDurationSeconds tracks it and exportMix.js's
// fade-out lands on the shot's real (sped) end.
function simulateScatterEvents(entry, durationSeconds) {
  const scatter = entry.scatter ?? {}
  const nominalShotDuration = Math.max(0, (entry.loopEnd ?? 0) - (entry.loopStart ?? 0))
  const events = []
  let offset = 0
  // A gap of exactly 0 (both bounds set to 0, "fully random" off) would spin
  // this loop forever and grow `events` unbounded - the shot just plays
  // back-to-back, so advance by the shot's own length instead (floored so a
  // zero-length trim can't stall it either). Also a hard event cap as a last
  // resort against any other runaway, matching the pipeline's own bounded-
  // resource discipline (v0.1.85).
  const MAX_EVENTS = 200000
  while (offset < durationSeconds && events.length < MAX_EVENTS) {
    const speedFactor = randomSpeedFactor(scatter)
    const shotDurationSeconds = nominalShotDuration / speedFactor
    events.push({
      offsetSeconds: offset,
      pitchSemitones: randomPitchSemitones(scatter),
      volumeScale: randomVolumeScale(scatter),
      speedFactor,
      fadeInMs: scatter.fadeInMs ?? 0,
      fadeOutMs: scatter.fadeOutMs ?? 0,
      shotDurationSeconds
    })
    const gap = randomGapSeconds(scatter)
    offset += gap > 0.001 ? gap : Math.max(shotDurationSeconds, 0.05)
  }
  return events
}

// An export has no wall clock - it's a stretch of time N seconds long - so a
// clock-anchored schedule can't be simulated against real time here. Per the
// owner's explicit instruction (inbox, 2026-09-01):
//
//   - An 'interval' schedule (e.g. "every full hour") is treated as a fixed
//     interval measured from the start of the export: it fires at
//     1x, 2x, 3x... the interval, up to the export length. No randomized
//     gap - the timing is exactly the interval, just relative to t=0
//     instead of midnight.
//   - A 'times' schedule (specific times of day like 07:30) is ignored
//     entirely - there's no meaningful way to place "7:30 AM" inside an
//     abstract 90-minute export, so those sounds are left out.
//
// This replaces the earlier approach of rolling secondsUntilNextTrigger from
// the real current time, which meant an export's scheduled sounds depended
// on what time of day you happened to run it (and often produced zero
// events - the reported bug: an hourly raven that "did not play once").
//
// Each event still carries randomized pitch/volume/fade the same way a
// scatter shot does (only the *timing* is deterministic). A per-shot pitch
// shift is duration-preserving since v0.1.111 (see simulateScatterEvents),
// so shotDurationSeconds is the plain trimmed length.
function simulateScheduledEvents(entry, durationSeconds) {
  const schedule = entry.schedule ?? {}
  if (schedule.type !== 'interval') return []

  const intervalSeconds = Math.max(1, schedule.intervalMinutes ?? 60) * 60
  const nominalShotDuration = Math.max(0, (entry.loopEnd ?? 0) - (entry.loopStart ?? 0))
  const events = []
  for (let offset = intervalSeconds; offset < durationSeconds; offset += intervalSeconds) {
    const speedFactor = randomSpeedFactor(schedule)
    events.push({
      offsetSeconds: offset,
      pitchSemitones: randomPitchSemitones(schedule),
      volumeScale: randomVolumeScale(schedule),
      speedFactor,
      fadeInMs: schedule.fadeInMs ?? 0,
      fadeOutMs: schedule.fadeOutMs ?? 0,
      shotDurationSeconds: nominalShotDuration / speedFactor
    })
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
export function simulateEvents({ entry, durationSeconds }) {
  const playMode = entry.playMode ?? 'loop'
  if (playMode === 'scatter') return simulateScatterEvents(entry, durationSeconds)
  if (playMode === 'scheduled') return simulateScheduledEvents(entry, durationSeconds)
  return null
}
