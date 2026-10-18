// Per-shot rules for Random Interval (scatter) and Scheduled sounds: when the
// next shot fires, and each shot's random pitch/volume/pan/speed and fade
// envelope. DOM-free and Electron-free, so the desktop Mixer and the phone
// player (noctivago-mobile) run the same picks. The audio node wiring stays
// in src/renderer/audio/ScatterSoundSource.js / ScheduledSoundSource.js.
import { pickBiasedValue } from './modulator.js'

// Matches the Remix plugin's Pitch slider range (plugins/editor/index.js) -
// the span rolled across when the explicit `pitchFullyRandom` toggle is on.
// (Before v0.1.105 this was a *hidden* behavior triggered by leaving both
// pitch bounds at 0; the owner asked for 0/0 to mean literally "no pitch
// variation" and for "fully random" to be an explicit, visible checkbox
// instead - see the scatter config in library.js.)
const DEFAULT_PITCH_RANGE_SEMITONES = 12
const DEFAULT_MIN_GAP_SECONDS = 5
const DEFAULT_MAX_GAP_SECONDS = 35
// The gap span rolled across when the explicit `gapFullyRandom` toggle is on
// (0 .. this). Not the 3600s the Remix number field allows - a fully-random
// gap that averaged half an hour would just be "barely ever plays"; 2 min is
// a generous ceiling for "scattered ambience" and the explicit min/max
// fields cover anything wider. Feel-tunable (flagged in the inbox Questions).
const FULLY_RANDOM_MAX_GAP_SECONDS = 120

// Game-engine "scattered ambience emitter" pattern (Wwise Random Container /
// FMOD Scatterer Instrument / Unity Audio Random Container) - re-triggers a
// short clip on a randomized gap instead of looping it back-to-back, with a
// randomized pitch each time. Shared by both scatter source variants.
export function randomGapSeconds(scatter) {
  if (scatter?.gapFullyRandom) {
    return Math.random() * FULLY_RANDOM_MAX_GAP_SECONDS
  }
  const min = Math.max(0, scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS)
  const max = Math.max(min, scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS)
  // "Bias" (Board backlog, owner inbox 2026-09-14): min/max stay the hard
  // range, but a bias value wins more often than a plain uniform pick -
  // reuses Fluctuation's own bias-skewed target math (Modulator.js) rather
  // than inventing a second distribution. Off by default (gapBiasEnabled),
  // so an existing sound's gap timing is untouched unless explicitly turned
  // on - same "explicit opt-in, not inferred from field values" precedent
  // gapFullyRandom itself already established.
  if (scatter?.gapBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.gapBiasSeconds ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

// The per-shot picks below are shared by Scatter and Scheduled sounds (both
// get the same per-shot pitch/volume/pan/speed/fade controls). The Export
// plugin keeps its own copy (plugin sandbox) - keep in sync.
export function randomPitchSemitones(scatter) {
  // `pitchFullyRandom` (explicit toggle): roll across the whole ±12 st range,
  // ignoring the min/max bounds entirely. Otherwise honor the bounds as set -
  // 0/0 now means literally "no pitch variation" (v0.1.105; before that, 0/0
  // was a hidden trigger for this fully-random behavior).
  if (scatter?.pitchFullyRandom) {
    return -DEFAULT_PITCH_RANGE_SEMITONES + Math.random() * 2 * DEFAULT_PITCH_RANGE_SEMITONES
  }
  let min = scatter?.minPitchSemitones ?? 0
  let max = scatter?.maxPitchSemitones ?? 0
  if (max < min) max = min
  // "Bias" - see randomGapSeconds's own comment above; same mechanism,
  // shared by scatter's own pitch and (via this same function) Scheduled's.
  if (scatter?.pitchBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.pitchBiasSemitones ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

// Unlike pitch, 0 isn't a neutral value for volume (it's silence), so there's
// no "both bounds at 0 means fully random" special case here - the neutral
// default is both bounds at 1 (always full volume, today's existing
// behavior), and a user who explicitly wants full random variation can
// already get it directly by setting min to 0.
// v0.1.218: volume gets the same "Fully random" (0..100%) and "Bias toward a
// value" options pitch has - both off by default, so an existing sound's
// volume picks are unchanged.
export function randomVolumeScale(scatter) {
  if (scatter?.volumeFullyRandom) return Math.random()
  const min = Math.max(0, scatter?.minVolume ?? 1)
  const max = Math.max(min, scatter?.maxVolume ?? 1)
  if (scatter?.volumeBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.volumeBias ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

// Per-play pan position (v0.1.218), -1 (left) .. 1 (right), applied by a
// PanStage after the shot's own (baked or live) static pan - the same
// two-stage arrangement Fluctuation's pan drift uses. Both bounds at 0 (the
// default) means no pan variation.
export function randomPanPosition(scatter) {
  if (scatter?.panFullyRandom) return -1 + Math.random() * 2
  const min = Math.max(-1, Math.min(1, scatter?.minPan ?? 0))
  const max = Math.max(min, Math.min(1, scatter?.maxPan ?? 0))
  if (scatter?.panBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.panBias ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

// Per-shot wall-clock playback speed (Random Interval / Scheduled "Speed"
// range), as a multiplier - 1 = original tempo, 2 = twice as fast (half as
// long), 0.5 = half speed. In the live Mixer this is plain `playbackRate`
// varispeed (pitch rises/falls with tempo, like a tape machine); exports
// keep pitch fixed via rubberband's own tempo pass. (Live used to WSOLA
// time-stretch this to preserve pitch too, but that buzzed on aggressive
// compression of broadband transients - v0.1.175.) Like volume, 1 isn't
// silence so there's
// no "both 0" special case - both bounds at 1 (the default) means no speed
// variation. Floored at 0.1 so a stray 0 can't divide-by-zero the duration
// math or ask for an infinite stretch.
export function randomSpeedFactor(scatter) {
  // Fully random / Bias (v0.1.227) work like the pitch/volume/pan picks;
  // fully random rolls the Remix bar's whole 50-200% range.
  if (scatter?.speedFullyRandom) return 0.5 + Math.random() * 1.5
  const min = Math.max(0.1, scatter?.minSpeed ?? 1)
  const max = Math.max(min, scatter?.maxSpeed ?? 1)
  if (scatter?.speedBiasEnabled) {
    const bias = Math.min(max, Math.max(min, scatter?.speedBias ?? (min + max) / 2))
    return pickBiasedValue(min, max, bias)
  }
  return min + Math.random() * (max - min)
}

// Ease in/out envelope for one shot, in seconds, clamped so fade-in and
// fade-out can never overlap/invert on a short shot (same "clamp to a
// fraction of the clip's own duration" pattern loopClip.js's crossfade
// already uses for the same reason).
export function fadeSeconds(scatter, durationSeconds) {
  const maxFade = Math.max(0, durationSeconds) / 2
  const fadeInSeconds = Math.min(Math.max(0, (scatter?.fadeInMs ?? 0) / 1000), maxFade)
  const fadeOutSeconds = Math.min(Math.max(0, (scatter?.fadeOutMs ?? 0) / 1000), maxFade)
  return { fadeInSeconds, fadeOutSeconds }
}

// Schedules a 0 -> target -> 0 envelope on `gainParam` across [startTime,
// startTime + durationSeconds], honoring fadeInSeconds/fadeOutSeconds (either
// or both may be 0, meaning an instant hard on/off edge at that end - the
// pre-fade-feature default). Shared by every scatter/scheduled source variant,
// since the envelope math is identical whatever produces the audio.
export function scheduleShotEnvelope(gainParam, target, startTime, durationSeconds, fadeInSeconds, fadeOutSeconds) {
  gainParam.cancelScheduledValues(startTime)
  if (fadeInSeconds > 0) {
    gainParam.setValueAtTime(0, startTime)
    gainParam.linearRampToValueAtTime(target, startTime + fadeInSeconds)
  } else {
    gainParam.setValueAtTime(target, startTime)
  }
  if (fadeOutSeconds > 0) {
    const fadeOutStart = Math.max(startTime + fadeInSeconds, startTime + durationSeconds - fadeOutSeconds)
    gainParam.setValueAtTime(target, fadeOutStart)
    gainParam.linearRampToValueAtTime(0, startTime + durationSeconds)
  }
}

// Real-world wall-clock playback ("a church's bell at 12:00 and 00:00", "an
// hourly chime, like a digital clock") - the trimmed clip plays once at each
// scheduled moment, then waits for the next one. The *when* is deterministic
// clock math (unlike Scatter's random gap), but per direct owner request
// ("the scheduled audios should have the exact same controls... as the
// random interval sounds have... it still needs fading, randomization and
// whatever") each shot's own character - pitch, volume, fade in/out - is
// randomized exactly the same way, by the per-shot picks above.
//
// schedule shape: { type: 'times', times: ['12:00', '00:00'] } for one or
// more fixed daily HH:MM (24h) triggers, or { type: 'interval',
// intervalMinutes: 60 } for a recurring interval aligned to midnight (so
// intervalMinutes: 60 always lands on the hour, 30 on the hour and half-
// hour, etc - "like a digital clock" rather than counting from whenever the
// app happened to start).
export function secondsUntilNextTrigger(schedule, now = new Date()) {
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

// Stable fingerprint of a scatter config - hasScatterConfig() compares two.
export function scatterKey(scatter) {
  return JSON.stringify({
    minGapSeconds: scatter?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS,
    maxGapSeconds: scatter?.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS,
    gapFullyRandom: Boolean(scatter?.gapFullyRandom),
    gapBiasEnabled: Boolean(scatter?.gapBiasEnabled),
    gapBiasSeconds: scatter?.gapBiasSeconds ?? null,
    minPitchSemitones: scatter?.minPitchSemitones ?? 0,
    maxPitchSemitones: scatter?.maxPitchSemitones ?? 0,
    pitchFullyRandom: Boolean(scatter?.pitchFullyRandom),
    pitchBiasEnabled: Boolean(scatter?.pitchBiasEnabled),
    pitchBiasSemitones: scatter?.pitchBiasSemitones ?? null,
    minVolume: scatter?.minVolume ?? 1,
    maxVolume: scatter?.maxVolume ?? 1,
    volumeFullyRandom: Boolean(scatter?.volumeFullyRandom),
    volumeBiasEnabled: Boolean(scatter?.volumeBiasEnabled),
    volumeBias: scatter?.volumeBias ?? null,
    minPan: scatter?.minPan ?? 0,
    maxPan: scatter?.maxPan ?? 0,
    panFullyRandom: Boolean(scatter?.panFullyRandom),
    panBiasEnabled: Boolean(scatter?.panBiasEnabled),
    panBias: scatter?.panBias ?? null,
    minSpeed: scatter?.minSpeed ?? 1,
    maxSpeed: scatter?.maxSpeed ?? 1,
    speedFullyRandom: Boolean(scatter?.speedFullyRandom),
    speedBiasEnabled: Boolean(scatter?.speedBiasEnabled),
    speedBias: scatter?.speedBias ?? null,
    fadeInMs: scatter?.fadeInMs ?? 0,
    fadeOutMs: scatter?.fadeOutMs ?? 0,
    syncGroup: scatter?.syncGroup ?? ''
  })
}

// Stable fingerprint of a schedule config - hasScheduleConfig() compares two.
export function scheduleKey(schedule) {
  return JSON.stringify({
    type: schedule?.type ?? 'times',
    times: [...(schedule?.times ?? [])].sort(),
    intervalMinutes: schedule?.intervalMinutes ?? 60,
    minPitchSemitones: schedule?.minPitchSemitones ?? 0,
    maxPitchSemitones: schedule?.maxPitchSemitones ?? 0,
    pitchFullyRandom: Boolean(schedule?.pitchFullyRandom),
    pitchBiasEnabled: Boolean(schedule?.pitchBiasEnabled),
    pitchBiasSemitones: schedule?.pitchBiasSemitones ?? null,
    minVolume: schedule?.minVolume ?? 1,
    maxVolume: schedule?.maxVolume ?? 1,
    volumeFullyRandom: Boolean(schedule?.volumeFullyRandom),
    volumeBiasEnabled: Boolean(schedule?.volumeBiasEnabled),
    volumeBias: schedule?.volumeBias ?? null,
    minPan: schedule?.minPan ?? 0,
    maxPan: schedule?.maxPan ?? 0,
    panFullyRandom: Boolean(schedule?.panFullyRandom),
    panBiasEnabled: Boolean(schedule?.panBiasEnabled),
    panBias: schedule?.panBias ?? null,
    minSpeed: schedule?.minSpeed ?? 1,
    maxSpeed: schedule?.maxSpeed ?? 1,
    speedFullyRandom: Boolean(schedule?.speedFullyRandom),
    speedBiasEnabled: Boolean(schedule?.speedBiasEnabled),
    speedBias: schedule?.speedBias ?? null,
    fadeInMs: schedule?.fadeInMs ?? 0,
    fadeOutMs: schedule?.fadeOutMs ?? 0
  })
}
