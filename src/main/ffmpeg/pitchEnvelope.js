import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'

// Bakes the Remix "Fluctuation" feature's slow random *pitch* drift into an
// export (v0.1.179) - the companion to gainEnvelope.js, which does the same
// for the volume axis. Live playback drives an AudioParam `detune` from a
// running Modulator (src/renderer/audio/Modulator.js); an export has no live
// audio graph, so this renders ONE realization of that same bounded random
// walk and expresses it as an ffmpeg `asendcmd` command file that steps the
// `rubberband` filter's `pitch` scale factor over time (verified against the
// real bundled binary: `rubberband`'s `pitch` option carries the timeline-
// command flag, and a stepped command file produces a smooth, length-
// preserving pitch glide on broadband content). Same "bake one realization"
// idea as scatter/scheduled shot placement and the volume envelope.
//
// Pitch fluctuation is per-sound only (a Sound Group / whole-mix bus is a sum
// of sources with nothing single to detune - see Modulator.js / the Board),
// so unlike gainEnvelope.js this is only ever applied to a single loop
// sound's own tiled track.
//
// The walk math below is a deliberate, self-contained copy of Modulator's
// (and mirrors gainEnvelope.js's own copy) - the main process never imports
// from src/renderer/. If Modulator's mapping changes (the flat-seconds
// timing + legacy changeRate/transition migration, the pow(r,1.7) bias skew,
// pickTarget, the fullyRandom uniform pick), change it in all three places.

// Must match Modulator.js's FLUCTUATION_PITCH_RANGE.
const PITCH_RANGE_SEMITONES = 6

// How often a `rubberband pitch` command is emitted, for a short/typical
// export. The drift is slow (a new target every 6-14 s by default, glided
// over ~8 s), so 100 ms steps are far finer than the signal's own motion;
// consecutive identical ratios are deduped so long near-bias stretches stay
// cheap. See MAX_COMMAND_FRAMES below - this is only the *finest* step used,
// not a fixed one.
const STEP_SECONDS = 0.1

// A real, reproducible bug in the bundled ffmpeg 6.1.1's own `asendcmd` file
// parser, found from a real crashed 9-hour export (owner-reported,
// 2026-09-13: "ffmpeg exited with code 4294967274... Missing separator or
// extraneous data found at the end of interval #1277... arg:(null)") and
// confirmed directly against the real binary: a command file has nothing
// wrong with its actual syntax (every line individually well-formed,
// verified), but past a size somewhere between ~95,000 and ~100,000 lines
// (~3.2-3.5MB) ffmpeg's own parser corrupts and fails - and, misleadingly,
// *reports* the failure at a much earlier, essentially arbitrary interval
// number (bisection showed the same file truncated well before its own
// reported failure point parses cleanly, and the crash reappears at the same
// file size regardless of which random walk generated the content). This is
// ffmpeg's bug, not fixable from here - the fix is keeping the command file
// well clear of the danger zone regardless of export length. 20,000 frames
// (~700KB at this format's line width) is a ~4-5x safety margin under the
// observed threshold, verified directly: a real 9-hour export's worth of
// fullyRandom (maximum-density, near-zero dedup) pitch drift, generated and
// fed through the real bundled ffmpeg, completes cleanly at this cap where
// it reliably crashed before.
const MAX_COMMAND_FRAMES = 20000

// The actual step used for a given export length - STEP_SECONDS when that
// already keeps the total frame count under the cap (true for anything up to
// ~33 minutes), otherwise stretched just enough to hit the cap exactly.
// samplePitchWalk and renderPitchCommandFile both derive their step from
// this so they never disagree about timing.
function resolveStepSeconds(durationSeconds) {
  return Math.max(STEP_SECONDS, durationSeconds / MAX_COMMAND_FRAMES)
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function num(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Mirror of Modulator.js's resolveFluctuationTiming / gainEnvelope.js's resolveTiming.
function resolveTiming(axis) {
  if (Number.isFinite(axis?.changeMinSeconds) || Number.isFinite(axis?.transitionSeconds)) {
    const lo = num(axis.changeMinSeconds, 6)
    const hi = num(axis.changeMaxSeconds, 14)
    return {
      changeMinSeconds: Math.max(0.1, Math.min(lo, hi)),
      changeMaxSeconds: Math.max(Math.max(0.1, Math.min(lo, hi)), hi),
      transitionSeconds: Math.max(0, num(axis.transitionSeconds, 8))
    }
  }
  if (Number.isFinite(axis?.changeRate) || Number.isFinite(axis?.transition)) {
    const r = num(axis.changeRate, 0.5)
    const t = num(axis.transition, 0.5)
    return {
      changeMinSeconds: lerp(20, 1.5, r) * 0.6,
      changeMaxSeconds: lerp(20, 1.5, r) * 1.4,
      transitionSeconds: lerp(9, 0.15, t) * 3
    }
  }
  return { changeMinSeconds: 6, changeMaxSeconds: 14, transitionSeconds: 8 }
}

// Reproduces Modulator's bounded random walk for `durationSeconds`, sampled
// at 1/STEP_SECONDS. Returns a Float64Array of semitone offsets (neutral 0,
// bounded to the config's min/max or +/-PITCH_RANGE_SEMITONES when
// fullyRandom). `rng` is injectable for deterministic tests.
export function samplePitchWalk(config, durationSeconds, rng = Math.random) {
  const fullyRandom = Boolean(config.fullyRandom)
  const min = fullyRandom ? -PITCH_RANGE_SEMITONES : Math.min(num(config.min, 0), num(config.max, 0))
  const max = fullyRandom ? PITCH_RANGE_SEMITONES : Math.max(num(config.min, 0), num(config.max, 0))
  const bias = fullyRandom ? 0 : Math.min(max, Math.max(min, num(config.bias, 0)))
  const timing = resolveTiming(config)
  const changeMin = timing.changeMinSeconds
  const changeSpan = timing.changeMaxSeconds - timing.changeMinSeconds
  const tau = Math.max(0, timing.transitionSeconds / 3)

  const jitteredInterval = () => changeMin + rng() * changeSpan
  const pickTarget = () => {
    if (fullyRandom) return min + rng() * (max - min)
    const lower = bias - min
    const upper = max - bias
    const span = lower + upper
    if (span <= 0) return bias
    const goUp = rng() < upper / span
    const t = Math.pow(rng(), 1.7)
    return goUp ? bias + t * upper : bias - t * lower
  }

  const dt = resolveStepSeconds(durationSeconds)
  const frames = Math.max(1, Math.ceil(durationSeconds / dt) + 1)
  const out = new Float64Array(frames)

  let value = bias
  let target = bias
  let nextChangeAt = jitteredInterval()
  const k = 1 - Math.exp(-dt / tau)
  for (let i = 0; i < frames; i++) {
    const now = i * dt
    if (now >= nextChangeAt) {
      target = pickTarget()
      nextChangeAt = now + jitteredInterval()
    }
    value += (target - value) * k
    out[i] = Math.max(min, Math.min(max, value))
  }
  return out
}

// True when a fluctuation config actually asks for pitch drift.
export function hasPitchFluctuation(fluctuation) {
  return Boolean(fluctuation?.pitch?.enabled)
}

function commandTempDir() {
  return path.join(app.getPath('userData'), 'export-tmp')
}

// Renders one realization of the pitch walk to an ffmpeg `asendcmd` command
// file (`<t> rubberband pitch <ratio>;` lines, deduped). Returns the file
// path (in export-tmp, so exportMix.js's own cleanup + the startup sweep both
// cover it) or null if the config isn't active.
export function renderPitchCommandFile(fluctuation, durationSeconds, rng = Math.random) {
  if (!hasPitchFluctuation(fluctuation)) return null
  const semis = samplePitchWalk(fluctuation.pitch, durationSeconds, rng)
  const step = resolveStepSeconds(durationSeconds)
  const lines = []
  let lastRatioStr = null
  for (let i = 0; i < semis.length; i++) {
    const t = (i * step).toFixed(3)
    const ratioStr = Math.pow(2, semis[i] / 12).toFixed(5)
    if (ratioStr === lastRatioStr) continue
    lines.push(`${t} rubberband pitch ${ratioStr};`)
    lastRatioStr = ratioStr
  }
  // A degenerate config that never moves off a single ratio still needs one
  // command so the caller's rubberband pass is a defined no-op, not skipped.
  if (lines.length === 0) lines.push(`0.000 rubberband pitch 1.00000;`)

  const filePath = path.join(commandTempDir(), `${crypto.randomUUID()}.cmd`)
  fs.mkdirSync(commandTempDir(), { recursive: true })
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
  return filePath
}

// The `-af` fragment that applies a command file to a track. Path is forced
// to forward slashes (the bundled ffmpeg accepts them on Windows) and single-
// quoted, matching loopClip.js's own `asendcmd=c='...'` usage; `pitchq=speed`
// is rubberband's faster mode, the same trade the per-shot export path
// already makes.
export function pitchCommandFilter(commandFilePath) {
  const escaped = commandFilePath.replace(/\\/g, '/').replace(/'/g, "\\'")
  return `asendcmd=f='${escaped}',rubberband=pitch=1:pitchq=speed`
}
