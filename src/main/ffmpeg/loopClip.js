import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { runFfmpegToFile, runFfmpegPipe } from './runFfmpeg.js'
import { resolveFfmpegPath } from './ffmpegPath.js'
import { buildPanFilter, normalizePan, parseChannelCount } from './panFilter.js'
import { getOrCreateReverbIR } from './reverbIR.js'
import { hasVolumeEnvelope, renderVolumeEnvelopeWav } from './volumeEnvelope.js'

const pending = new Map()

// BUG FIX (reported directly: "the saved audio preview... once you save new
// changes on top of it while it plays it locks out the saved audio option").
// Root-caused via a standalone repro script, not guessed at: a plain
// fs.renameSync onto a file that this same process's own sound:// protocol
// handler still has open for reading (Remix's "Saved audio" toggle streams
// the clip file live via fs.createReadStream) deterministically throws
// EPERM on Windows - confirmed both for a single in-flight read and for
// continuous back-to-back range reads (the latter needed up to ~20 retries/
// 1.8s to clear in the adversarial case, since Windows only allows the
// rename once every open handle without FILE_SHARE_DELETE has actually
// closed). The lock is transient either way - a Range read finishes and
// closes on its own - so a plain caught exception here was surfacing a real,
// successfully-decoded render as a hard "render failed" (which forces the
// preview back to Live and disables the toggle, see index.js's
// updatePreviewModeToggle) purely because the exact file being edited
// happened to be mid-stream at the wrong instant. Retrying with a short
// backoff instead costs nothing in the common (not-currently-playing) case
// and reliably clears the lock in the one that matters.
async function renameWithRetry(tmpPath, outputPath, maxAttempts = 30, delayMs = 100) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmpPath, outputPath)
      return
    } catch (err) {
      if (attempt === maxAttempts || (err.code !== 'EPERM' && err.code !== 'EBUSY')) throw err
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

// BUG FIX (2026-08-16): discovered while verifying the (since replaced) rotation fix
// against a real (not synthetic) file - ffmpeg's acrossfade silently
// produces a *completely empty* output, with no error and exit code 0, if
// its first input is even a few milliseconds shorter than the declared `d`.
// Confirmed a real Opus file (through a YouTube-download/optimize pipeline)
// where the container's own claimed duration overstated the truly
// decodable audio by ~6ms - small enough to be invisible, but enough to
// collapse the "tail" read to just under the requested crossfade length,
// which made acrossfade emit nothing and left the render silently
// crossfade-free (concat just carried mainF's length through unchanged).
// This wasn't introduced by the rotation change - it's been latent
// in the original tail/head crossfade since it first shipped, for any
// source file where the last `fade` seconds aren't fully decodable for
// this same reason - plausibly a real contributor to loops that "still
// sound abrupt" despite the feature nominally being active.
//
// The first fix attempt here just shrank `fade` when the tail came up
// short - wrong, and proven wrong against the same real file: shrinking
// `fade` while still anchoring the tail read to the same `loopEnd` doesn't
// help, because the actual problem is that `loopEnd` itself sits past what
// the source can truly decode, not that the *window size* was wrong. Any
// read still aimed at that same unreachable endpoint comes up short by
// (approximately) the same absolute amount regardless of how small the
// window gets, so the collapse just kept recurring at the new, smaller
// fade. The real fix (see doRender) is to pull the *target endpoint*
// itself in to match what's truly decodable when a shortfall is detected,
// not to shrink the crossfade window around an endpoint that doesn't
// exist - the few milliseconds this trims off the requested loopEnd are
// inaudible and don't need to be reconciled with anything else, since the
// baked clip's own real duration is what BufferSoundSource actually loops,
// not a value recomputed from loopStart/loopEnd at playback time.
//
// Probes via raw headerless PCM at a low sample rate (8kHz, mono) piped to
// memory - cheap since the window being probed is always small (at most a
// couple of seconds) regardless of how long the overall clip is.
const PROBE_SAMPLE_RATE = 8000

async function probeAvailableDuration(inputPath, start, requestedDuration) {
  if (requestedDuration <= 0) return 0
  let byteCount = 0
  await runFfmpegPipe(
    [
      '-ss', start.toFixed(6), '-t', requestedDuration.toFixed(6), '-i', inputPath,
      '-vn', '-ac', '1', '-ar', String(PROBE_SAMPLE_RATE), '-f', 's16le', 'pipe:1'
    ],
    (chunk) => {
      byteCount += chunk.length
    }
  )
  return byteCount / 2 / PROBE_SAMPLE_RATE
}

// Same technique as probeAvailableDuration (decode to raw headerless PCM at a
// low sample rate and count bytes, never buffering the decoded audio - same
// O(1)-memory approach waveformPeaks.js already uses for whole-file reads),
// but with no -t cap, so it reads clear through to EOF - used to learn a
// freshly-imported file's real duration before its metadata has ever been
// probed any other way (see library.js's eager-bake-on-import setting, the
// one caller of this outside the normal Save/first-play paths, both of which
// already have a duration from waitForMetadata() by the time they render).
// Channel count of inputPath's first audio stream, read from ffmpeg's own
// stream-info line (same stderr technique as bandEnergy.js's
// probeSourceSampleRate). Only called when a sound is actually panned.
export function probeChannelCount(inputPath) {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpegPath(), ['-i', inputPath, '-t', '0.01', '-f', 'null', '-'], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', () => resolve(parseChannelCount(stderr) ?? 2))
    child.on('error', () => resolve(2))
  })
}

export async function probeDurationSeconds(inputPath) {
  let byteCount = 0
  await runFfmpegPipe(
    ['-i', inputPath, '-vn', '-ac', '1', '-ar', String(PROBE_SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
    (chunk) => {
      byteCount += chunk.length
    }
  )
  return byteCount / 2 / PROBE_SAMPLE_RATE
}

// Default length of the self-crossfade blended into the tail of every
// rendered clip (see buildFilterComplex) so the loop seam has no hard
// discontinuity, even when the audio content itself doesn't naturally
// repeat. Used whenever a sound has no per-sound override (entry.
// crossfadeSeconds is null - see library.js) - see renderLoopClip's
// crossfadeSeconds param for the override path, added after 0.2s alone
// still weren't enough to mask the seam on some real, especially
// transient-heavy content and the user asked to be able to tune it per
// sound rather than guess at one global constant forever. Clamped per-clip
// against the clip's own duration (see doRender) so neither this default
// nor a user-chosen override can misbehave on a very short trim.
//
// BUG FIX (2026-08-16): was 0.03 (30ms) - too short for real, transient-
// heavy ambient content (rain, in the reported case) to actually mask the
// seam. Measured directly against a real user file (a highpass/lowpass/
// gain-filtered rain recording): the sample-level discontinuity at the loop
// wrap point (comparing the clip's last sample to its first) dropped from
// 48/32768 at 30ms to 9/32768 at 200ms - roughly an 80% reduction - with no
// clipping (astats confirmed peak well under 0dB at 200ms). Bumped from an
// untested "should be enough" guess to a value verified against real,
// difficult content, not just synthetic sine tones (which crossfade
// trivially well regardless of duration and had masked this gap in the
// original testing).
export const DEFAULT_CROSSFADE_SECONDS = 0.2

function clipsDir() {
  return path.join(app.getPath('userData'), 'clips')
}

export function getLoopClipPath(id) {
  return path.join(clipsDir(), `${id}.wav`)
}

// ffmpeg's aecho takes one fixed delay/decay per tap - it doesn't loop a
// signal back through itself the way a real feedback delay does. The live
// preview (PreviewSource.js / SoundSource.js) uses an actual Web Audio
// feedback loop, which produces an unbounded train of repeats at
// delayMs, 2*delayMs, 3*delayMs... each attenuated by decay^n. This
// generates a fixed number of explicit taps following that same geometric
// curve, so the baked clip's echo tail matches what was heard in preview
// instead of sounding like a single, oddly bare repeat.
const ECHO_TAPS = 6

// Exported (2026-09-06) so exportMix.js's whole-mix/group post-processing
// chains can build the exact same echo filter for a preset's or Sound
// Group's own echo setting, mirroring buildEqBandFilter's own already-
// established export reasoning right below - same directory, no plugin-
// boundary duplication needed.
export function buildEchoFilter(delayMs, decay) {
  const delays = []
  const decays = []
  for (let i = 1; i <= ECHO_TAPS; i++) {
    delays.push(Math.round(delayMs * i))
    decays.push((decay ** i).toFixed(4))
  }
  return `aecho=1.0:1.0:${delays.join('|')}:${decays.join('|')}`
}

// Noise gate (Remix, per-sound) - ffmpeg's own `agate`, verified against the
// real bundled binary before writing this (a pink-noise floor at -54dB gated
// down to -91dB while loud events passed through untouched). Maps the UI's dB
// units to agate's linear 0..1 threshold/range: thresholdDb is where the gate
// opens; rangeDb is how far below it the quiet parts are pushed (agate's
// `range` is the *floor gain*, so a bigger reduction is a smaller linear
// value). ratio=9000 makes it a hard gate rather than a downward expander;
// detection=rms matches the live NoiseGate.js follower. `agate` has no hold
// parameter (Audacity's noisegate.ny does) - a generous Release covers the
// same "don't chatter on a decaying tail" need in practice, and the optional
// high/low crossover from that same reference is a deferred follow-up (a
// naive lowpass+highpass split sums to a deep null at the crossover
// frequency, so doing it right needs a complementary-filter pass). Returns
// null when the gate is off (threshold at its -80 floor, or zero reduction).
export function buildGateFilter(filters) {
  const thr = Number.isFinite(filters?.gateThresholdDb) ? filters.gateThresholdDb : -80
  const rangeDb = Number(filters?.gateRangeDb) || 0
  if (!(thr > -80) || !(rangeDb > 0)) return null
  const thresholdLin = Math.pow(10, thr / 20)
  const rangeLin = Math.pow(10, -Math.abs(rangeDb) / 20)
  const attack = Math.max(1, Number(filters?.gateAttackMs) || 10)
  const release = Math.max(1, Number(filters?.gateReleaseMs) || 150)
  return `agate=threshold=${thresholdLin.toFixed(6)}:range=${rangeLin.toFixed(6)}:attack=${attack}:release=${release}:ratio=9000:detection=rms`
}

// Noise reduction (Remix, Sound mode) - ffmpeg's FFT denoiser `afftdn`, run
// in its two-step "sample a noise-only region, then subtract that profile"
// mode via an asendcmd cue (`afftdn sample_noise start/stop`), the direct
// analogue of Audacity's "Get noise profile -> apply" workflow. Verified
// against the real bundled binary before writing this: a -30dB white-noise
// floor under an intermittent tone dropped ~13-15dB (hiss and hum alike)
// with the tone left untouched to the measured 0.1dB.
//
// afftdn's `nf` (noise floor, -80..-20) only matters up to the point
// sample_noise refines the per-band profile, but the sampled region's own
// measured RMS level is still the best starting estimate - and there's no
// live preview to tune it by ear (see below) - so doRender measures the
// noise region's RMS first (measureRegionRmsDb) and passes it in as `nf`.
// `nr` (1..48 here, 0.01..97 in ffmpeg) is the user-facing strength knob.
//
// The sample window is stored as absolute file seconds (denoiseSampleStartSec
// /EndSec, alongside the trim Start/End) but used *relative to loopStart*,
// because this only ever runs inside doRender's pre-processing pass, which
// reads `-ss loopStart -t (loopEnd-loopStart)`. An unset or degenerate
// window falls back to the first ~1.5s of the trimmed region. Returns null
// when disabled or the region is too short to sample - callers then skip the
// whole pass, leaving the default render path byte-identical.
//
// There is no Web Audio equivalent of a spectral-subtraction denoiser, so
// unlike highpass/lowpass/gain/EQ/gate this has no live preview - it's
// bake-only, heard via buffer mode / Remix's "Saved audio" toggle, same as
// Doppler and Reverse.
const NOISE_MEASURE_SAMPLE_RATE = 32000

async function measureRegionRmsDb(inputPath, start, duration) {
  if (duration <= 0) return null
  let sumSq = 0
  let count = 0
  await runFfmpegPipe(
    [
      '-ss', start.toFixed(6), '-t', duration.toFixed(6), '-i', inputPath,
      '-vn', '-ac', '1', '-ar', String(NOISE_MEASURE_SAMPLE_RATE), '-f', 's16le', 'pipe:1'
    ],
    (chunk) => {
      for (let i = 0; i + 1 < chunk.length; i += 2) {
        const s = chunk.readInt16LE(i)
        sumSq += s * s
        count += 1
      }
    }
  )
  if (count === 0) return null
  const rms = Math.sqrt(sumSq / count) / 32768
  return rms > 0 ? 20 * Math.log10(rms) : -120
}

function resolveNoiseWindow(filters, loopStart, loopEnd) {
  const duration = loopEnd - loopStart
  let ns = Number(filters.denoiseSampleStartSec)
  let ne = Number(filters.denoiseSampleEndSec)
  if (!Number.isFinite(ns) || !Number.isFinite(ne) || ne - ns < 0.1) {
    ns = loopStart
    ne = loopStart + Math.min(1.5, duration / 3)
  }
  ns = Math.min(Math.max(ns, loopStart), loopEnd)
  ne = Math.min(Math.max(ne, ns), loopEnd)
  return { ns, ne }
}

export async function buildNoiseReductionChain(inputPath, filters, loopStart, loopEnd) {
  if (!filters?.denoiseEnabled) return null
  const duration = loopEnd - loopStart
  if (!(duration > 0.2)) return null
  const nr = Math.min(48, Math.max(1, Number(filters.denoiseStrengthDb) || 12))
  const { ns, ne } = resolveNoiseWindow(filters, loopStart, loopEnd)
  if (ne - ns < 0.05) return null
  const measuredDb = await measureRegionRmsDb(inputPath, ns, ne - ns)
  const nf = measuredDb == null ? -40 : Math.min(-20, Math.max(-80, measuredDb))
  const relStart = (ns - loopStart).toFixed(3)
  const relEnd = (ne - loopStart).toFixed(3)
  return `asendcmd=c='${relStart} afftdn sample_noise start; ${relEnd} afftdn sample_noise stop',afftdn=nr=${nr}:nf=${nf.toFixed(1)}`
}

// Maps one EQ band's chosen type to the real ffmpeg filter that implements
// it, verified against the real bundled binary before writing this (all six
// filter types chained together in one real invocation, exit 0, real
// output). 'off' is a pseudo-type (not a real biquad shape) - returns null,
// simply omitted from the chain, which is a cleaner and cheaper "no
// processing" than baking a real no-op filter like allpass. `type` is
// nullable for backward compat - a band saved before this field existed
// defaults to 'peaking', matching its only previous behavior. Only
// peaking/lowshelf/highshelf are true no-ops at gainDb 0 (their entire
// effect is proportional to gain) - lowpass/highpass/bandpass/notch have no
// gain parameter at all and always shape the signal whenever selected, so
// they're never skipped just for being "neutral."
// Only the four filter-*shaped* types have a real "slope" (rolloff
// steepness) concept - peaking/shelf types are gain-shaped, 'off' does
// nothing. ffmpeg's highpass/lowpass filters have a real `poles` parameter,
// but bandpass/bandreject don't (fixed two-pole Butterworth) - to keep
// "Steep" consistent across all four shaped types (and match the exact same
// cascading technique Web Audio needs, since BiquadFilterNode has no slope
// parameter either), steep is real repetition: the same single-stage filter
// string chained STEEP_STAGE_COUNT times in the -af chain, each stage
// multiplying the rolloff by another ~12dB/octave. Verified directly against
// the real bundled ffmpeg binary before implementing (four cascaded
// highpass=f=1000:poles=2 instances measured ~34dB more attenuation than
// one, on a real test tone). Mirrors SoundSource.js's/PreviewSource.js's
// identical helper.
const SLOPE_CAPABLE_EQ_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
const STEEP_STAGE_COUNT = 4
export function eqBandStageCount(band) {
  return band.slope === 'steep' && SLOPE_CAPABLE_EQ_TYPES.includes(band.type) ? STEEP_STAGE_COUNT : 1
}

// Exported (2026-09-02) so exportMix.js's whole-mix post-processing chain
// can build the exact same per-band ffmpeg filter for a preset's Preset
// Remix EQ, rather than a second, duplicated implementation - both live in
// src/main/ffmpeg/ (not across a plugin boundary), so a plain import is the
// right call here, unlike every plugins/ duplication elsewhere in this app.
export function buildEqBandFilter(band) {
  if (band.muted) return null
  const type = band.type ?? 'peaking'
  const { freqHz: f, q, gainDb: g } = band
  switch (type) {
    case 'off':
      return null
    case 'peaking':
      return g ? `equalizer=f=${f}:width_type=q:w=${q}:g=${g}` : null
    case 'lowshelf':
      return g ? `bass=f=${f}:width_type=q:w=${q}:g=${g}` : null
    case 'highshelf':
      return g ? `treble=f=${f}:width_type=q:w=${q}:g=${g}` : null
    case 'lowpass':
      return `lowpass=f=${f}:width_type=q:w=${q}`
    case 'highpass':
      return `highpass=f=${f}:width_type=q:w=${q}`
    case 'bandpass':
      return `bandpass=f=${f}:width_type=q:w=${q}`
    case 'notch':
      return `bandreject=f=${f}:width_type=q:w=${q}`
    default:
      return null
  }
}

// Builds an ffmpeg filter chain fragment from a {gateThresholdDb/Range/Attack/
// Release, highpassHz, lowpassHz, gainDb, echoDelayMs, echoDecay, eq} filter
// set, skipping any band left at its neutral/no-op value. Returns null if
// every band is neutral (nothing to apply). Deliberately excludes reverbSizeMs/reverbMix - afir needs a
// second ffmpeg *input* (the impulse response), which can't join this plain
// comma-separated -af fragment; see applyReverbPass/doRender below for its
// own isolated pass.
function buildFilterChain(filters) {
  if (!filters) return null
  const parts = []
  // Gate first - it should act on the raw trimmed source, before highpass/EQ
  // colour it (same position the live NoiseGate.js sits at, and the
  // conventional channel-strip order).
  const gate = buildGateFilter(filters)
  if (gate) parts.push(gate)
  if (filters.highpassHz > 0) parts.push(`highpass=f=${filters.highpassHz}`)
  if (filters.lowpassHz > 0 && filters.lowpassHz < 20000) parts.push(`lowpass=f=${filters.lowpassHz}`)
  if (filters.gainDb) parts.push(`volume=${filters.gainDb}dB`)
  if (filters.echoDelayMs > 0 && filters.echoDecay > 0) parts.push(buildEchoFilter(filters.echoDelayMs, filters.echoDecay))
  for (const band of filters.eq ?? []) {
    const bandFilter = buildEqBandFilter(band)
    if (bandFilter) {
      for (let stage = 0; stage < eqBandStageCount(band); stage++) parts.push(bandFilter)
    }
  }
  return parts.length > 0 ? parts.join(',') : null
}

// Default how far the pitch swings (in semitones) - now a user-adjustable
// value (speedPitch.dopplerIntensitySemitones, a Remix slider) rather than
// this fixed constant alone; kept as the fallback for entries saved before
// the control existed. 5 was the original fixed value, chosen as a clearly
// audible pass-by without tipping into "obviously fake siren" territory.
const DEFAULT_DOPPLER_INTENSITY_SEMITONES = 5

// How abruptly the pitch swings through the marker (speedPitch.dopplerSharpness,
// a 0..1 Remix slider). This is what makes it sound like a *pass-by* rather
// than a slow detune: at a low value the pitch glides continuously across the
// whole clip (the original, and what a direct report called out as "just
// lowering the pitch progressively"); at a high value the pitch sits roughly
// flat - high while approaching, low while receding - and does its whole swing
// in a short burst right at the marker, the classic siren "fwooo-yowm" of
// something rushing past close by. 0.5 is a clearly plateau-shaped pass-by
// without the transition being so sharp it reads as a glitch. Kept as the
// fallback for entries saved before the control existed.
const DEFAULT_DOPPLER_SHARPNESS = 0.5

// Floor on how close the draggable "closest point" marker (closestFraction,
// see below) can get to either edge - without this, dragging it all the way
// to Start or End would collapse one side's ramp to zero duration, an
// instant jump rather than a bend (and a literal divide-by-zero in the slope
// math below). Matches LoopEditor.js's own identical clamp on the drag side,
// duplicated for the usual cross-directory (renderer can't reach main) plus
// main/renderer process split reasons.
const MIN_DOPPLER_FRACTION = 0.05

// Generates a sequence of timestamped `rubberband pitch <value>;` commands
// (ffmpeg's asendcmd syntax) spanning [0, durationSeconds] - the trimmed
// loop region's own duration, matching what this pre-processing pass
// actually reads via -ss/-t before any of this runs. The pitch contour
// follows the physical Doppler model f'/f = c / (c + v*cos0) rather than a
// straight semitone ramp: as a source moves past on a straight line,
// cos0 (the along-track angle) swings from ~+1 while approaching, through 0
// at closest approach, to ~-1 while receding, and how *fast* it swings
// through 0 depends on how close the pass is. That gives the characteristic
// flat-high / fast-drop / flat-low siren shape - a plain linear ramp
// instead just sounds like a slow continuous detune (a directly-reported
// bug). The "closest" marker is at t=durationSeconds*closestFraction
// (user-draggable on the waveform, defaulting to the midpoint):
//
// - Normal (reversed=false): high pitch (+intensity) while approaching,
//   crossing exactly natural at the marker, low pitch (-intensity) while
//   receding - the marker is the natural-pitch crossing, Start/End are the
//   extremes.
// - Reversed: Start/End sit at natural pitch and the full high->low swing
//   happens in a short burst right at the marker (a raised-cosine window
//   tapers it back to natural by the ends) - models something darting
//   sharply past very close rather than a distant approach/recede.
//
// sharpness01 (0..1) maps exponentially to k, the model's effective "how
// close does it pass" factor: small k keeps cos0 near 0 for most of the
// clip (a gentle glide), large k drives cos0 to +/-1 everywhere except at
// the marker (flat plateaus, fast transition). The contour is renormalized
// so it still hits exactly +/-intensity at Start/End regardless of k.
//
// The two segments either side of the marker are each scaled to their own
// length, so a marker dragged off-center makes one side swing faster than
// the other - the point of making it draggable. Composed multiplicatively
// with whatever static pitchSemitones is already set, so the two controls
// stack. ~10 commands/second is dense enough that rubberband (which does its
// own internal smoothing between commands) produces a continuous-sounding
// bend rather than audible discrete steps.
function buildDopplerSendCmd(basePitchRatio, durationSeconds, closestFraction = 0.5, intensitySemitones = DEFAULT_DOPPLER_INTENSITY_SEMITONES, reversed = false, sharpness01 = DEFAULT_DOPPLER_SHARPNESS) {
  if (durationSeconds <= 0) return null
  const frac = Math.min(Math.max(closestFraction, MIN_DOPPLER_FRACTION), 1 - MIN_DOPPLER_FRACTION)
  const closestT = frac * durationSeconds
  const steps = Math.max(8, Math.min(400, Math.round(durationSeconds * 10)))
  const sharp = Math.min(Math.max(sharpness01, 0), 1)
  const k = 0.6 * Math.pow(30, sharp) // ~0.6 (gentle glide) .. ~18 (hard plateaus)
  const edgeCos = k / Math.sqrt(1 + k * k) // |contour| at the segment ends, for renormalizing to +/-intensity
  const parts = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * durationSeconds
    const beforeMarker = t <= closestT
    // signed normalized position: -1 at Start, 0 at the marker, +1 at End,
    // each side scaled to its own length (the off-center-marker behavior).
    const s = beforeMarker
      ? (t - closestT) / closestT
      : (t - closestT) / (durationSeconds - closestT)
    // cos0-shaped contour: ~linear through the marker, saturating to a
    // plateau away from it. Renormalized so |contour| == 1 at s = +/-1.
    const contour = ((k * s) / Math.sqrt(1 + (k * s) * (k * s))) / edgeCos
    const semitoneOffset = reversed
      ? -intensitySemitones * contour * Math.pow(Math.cos((Math.PI * s) / 2), 2)
      : -intensitySemitones * contour
    const pitch = basePitchRatio * Math.pow(2, semitoneOffset / 12)
    parts.push(`${t.toFixed(3)} rubberband pitch ${pitch.toFixed(6)};`)
  }
  return parts.join('')
}

// rubberband's tempo/pitch are scale factors, not the semitone/percent units
// the UI works in - pitchSemitones converts via the standard equal-
// temperament ratio (2^(semitones/12)); speed is already a plain multiplier.
// durationSeconds is the trimmed loop region's own length (loopEnd -
// loopStart), needed only to compute the Doppler sweep's midpoint - unused
// otherwise. Returns null when speed/pitch/doppler are all neutral and
// reversed is false, so callers can skip the whole pre-processing pass
// entirely for the default, most-common case.
function buildSpeedPitchReverseChain(speedPitch, durationSeconds) {
  if (!speedPitch) return null
  const {
    speed = 1,
    pitchSemitones = 0,
    reversed = false,
    dopplerEnabled = false,
    dopplerClosestFraction = 0.5,
    dopplerIntensitySemitones = DEFAULT_DOPPLER_INTENSITY_SEMITONES,
    dopplerReversed = false,
    dopplerSharpness = DEFAULT_DOPPLER_SHARPNESS
  } = speedPitch
  const parts = []
  if (speed !== 1 || pitchSemitones !== 0 || dopplerEnabled) {
    const pitchRatio = Math.pow(2, pitchSemitones / 12)
    if (dopplerEnabled) {
      const sendCmd = buildDopplerSendCmd(pitchRatio, durationSeconds, dopplerClosestFraction, dopplerIntensitySemitones, dopplerReversed, dopplerSharpness)
      if (sendCmd) parts.push(`asendcmd=c='${sendCmd}'`)
    }
    // channels=together: ~1.12x faster than rubberband's default of shifting
    // each channel independently, and it avoids the stereo decorrelation /
    // smear that independent per-channel shifting causes - the same defect
    // fixed on the live-playback side in v0.1.112 (see pitchStretch.js).
    // Benchmarked 2026-09-16 against the real bundled ffmpeg; see
    // exportMix.js's RUBBERBAND_OPTS for the full measurements.
    parts.push(`rubberband=tempo=${speed}:pitch=${pitchRatio.toFixed(6)}:channels=together`)
  }
  if (reversed) parts.push('areverse')
  return parts.length > 0 ? parts.join(',') : null
}

// Reads a WAV file's real duration straight from its own RIFF/data chunk
// header rather than spawning ffprobe (not bundled) or another ffmpeg
// process - used only on WAV files this module just rendered itself (see
// doRender's pre-processing pass), so the format is always exactly what's
// expected.
function readWavDuration(filePath) {
  const buf = fs.readFileSync(filePath)
  let offset = 12
  let channels, sampleRate, bitsPerSample
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    }
    if (id === 'data') return size / ((bitsPerSample / 8) * channels) / sampleRate
    offset += 8 + size + (size % 2)
  }
  return 0
}

// Builds the filter_complex that crossfades the clip's own tail into its own
// head, given three separate reads of the same source (see
// renderCrossfadedLoop): input 0 is the body [S+f, E-f), input 1 is the tail
// [E-f, E), input 2 is the head [S, S+f). The tail blends into the head, and
// that blend is appended after the body - so the clip starts at source time
// S+f and ends on source time S+f too, and the wrap point is continuous. The
// loop comes out `fade` seconds shorter than the trim, which is exactly what
// the live two-element crossfade (SoundSource.js / PreviewSource.js) plays:
// the tail fades out while the head fades in, then playback carries on from
// S+f.
//
// BUG FIX (v0.1.221): the body used to be [S, E-f), so the blend ended on
// S+f but the clip wrapped back to S - a jump of exactly `fade` seconds of
// audio on every loop. A later half-rotation (2026-08-16) only moved that
// jump into the middle of the clip. Measured with a linear-ramp source
// (sample value = source time): the old graph jumped 0.2s at 6.0s of a 12s
// clip; this one has no jump anywhere, wrap included.
//
// The curve is equal-power (qsin), not linear: tail and head are different
// moments of the source, so for the noisy textures this app is mostly used
// for (rain, fire, crowds) they're uncorrelated, and a linear blend dips
// ~3 dB in the middle of the seam - an audible "breath" on every loop.
//
// This *must* stay three separate ffmpeg inputs rather than one input
// split+trimmed internally (asplit/atrim on a single stream) - that was
// tried first and silently produced truncated output. Verify against real
// output, not just exit code 0, before changing this.
// atrim after the filter chain matters specifically for echo: aecho extends
// its output past the input's own length to fit the echo tail, which would
// desync acrossfade/concat's exact-duration assumptions. On a looping clip
// any tail past the loop point is cut by the wrap anyway.
function buildFilterComplex(filters, fade, bodyDuration) {
  const filterChain = buildFilterChain(filters)
  const suffix = filterChain ? `,${filterChain}` : ''

  return [
    `[0:a:0]anull${suffix},atrim=start=0:end=${bodyDuration}[bodyF]`,
    `[1:a:0]anull${suffix},atrim=start=0:end=${fade}[tailF]`,
    `[2:a:0]anull${suffix},atrim=start=0:end=${fade}[headF]`,
    `[tailF][headF]acrossfade=d=${fade}:c1=qsin:c2=qsin[blended]`,
    `[bodyF][blended]concat=n=2:v=0:a=1[out]`
  ].join(';')
}

// Renders just [loopStart, loopEnd) of inputPath — with any filters baked
// in — into its own small WAV file, so it can be fully decoded client-side
// for native, sample-accurate looping instead of streaming the (possibly
// huge) original with an approximate seek-back loop. Never throws — callers
// get {ok:false, error} instead, so a failed render can't block saving the
// loop points/filters themselves. crossfadeSeconds is nullable — null (or
// undefined) means "use DEFAULT_CROSSFADE_SECONDS", matching a sound that's
// never had it explicitly overridden in the Remix plugin. speedPitch is
// nullable too — null/neutral values skip the pre-processing pass below
// entirely, leaving the default (no speed/pitch/reverse) path byte-for-byte
// identical to before this option existed.
export function renderLoopClip({ id, inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch }) {
  if (pending.has(id)) return pending.get(id)

  const promise = doRender({ id, inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch }).finally(() =>
    pending.delete(id)
  )
  pending.set(id, promise)
  return promise
}

// The actual crossfade render, unchanged from before speed/pitch/
// reverse existed - takes inputPath/loopStart/loopEnd/filters exactly as it
// always has. Split out so doRender can point it at either the original
// source directly (the common case) or at a pre-processed intermediate (see
// doRender's speed/pitch/reverse branch) without duplicating this logic.
// pan (v0.1.216) is applied as the very last stage of this render - after
// every filter and, on doRender's pre-pass path, after reverb/envelope too,
// matching the live chain where the StereoPannerNode sits just before the
// per-sound volume. It's memoryless, so running it after the trim and
// crossfade is equivalent to running it before them.
async function renderCrossfadedLoop({ inputPath, loopStart, loopEnd, filters, crossfadeSeconds, pan = 0, outputPath }) {
  const tmpPath = `${outputPath}.tmp`
  const panFilter = normalizePan(pan) !== 0 ? buildPanFilter(pan, await probeChannelCount(inputPath)) : null

  const duration = loopEnd - loopStart
  const requestedFade = crossfadeSeconds ?? DEFAULT_CROSSFADE_SECONDS
  let fade = Math.max(0, Math.min(requestedFade, duration / 4))

  // See probeAvailableDuration's comment for why this pulls the *endpoints*
  // in rather than shrinking `fade` - a probed shortfall means the source
  // genuinely can't be decoded that far, not that the window was too big.
  let effectiveLoopStart = loopStart
  let effectiveLoopEnd = loopEnd
  if (fade > 0) {
    const [availableTail, availableHead] = await Promise.all([
      probeAvailableDuration(inputPath, loopEnd - fade, fade),
      probeAvailableDuration(inputPath, loopStart, fade)
    ])
    const tailShortfall = fade - availableTail
    if (tailShortfall > 0.0005) effectiveLoopEnd = loopEnd - tailShortfall - 0.001
    const headShortfall = fade - availableHead
    if (headShortfall > 0.0005) effectiveLoopStart = loopStart + headShortfall + 0.001
  }
  const effectiveDuration = effectiveLoopEnd - effectiveLoopStart
  fade = Math.max(0, Math.min(fade, effectiveDuration / 4))

  let args
  if (fade <= 0) {
    // Crossfade explicitly disabled (slider at 0ms) - honor that literally
    // rather than silently forcing a minimum: a plain trim with no edit at
    // all, matching every other "0 = Off" control already in this app.
    const filterChain = [buildFilterChain(filters), panFilter].filter(Boolean).join(',')
    args = [
      '-y',
      '-ss', effectiveLoopStart.toFixed(6), '-t', effectiveDuration.toFixed(6), '-i', inputPath,
      ...(filterChain ? ['-af', filterChain] : []),
      '-vn',
      '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', tmpPath
    ]
  } else {
    const bodyDuration = effectiveDuration - 2 * fade
    args = [
      '-y',
      '-ss', (effectiveLoopStart + fade).toFixed(6), '-t', bodyDuration.toFixed(6), '-i', inputPath,
      '-ss', (effectiveLoopEnd - fade).toFixed(6), '-t', fade.toFixed(6), '-i', inputPath,
      '-ss', effectiveLoopStart.toFixed(6), '-t', fade.toFixed(6), '-i', inputPath,
      '-filter_complex',
      buildFilterComplex(filters, fade.toFixed(6), bodyDuration.toFixed(6)) +
        (panFilter ? `;[out]${panFilter}[panned]` : ''),
      '-map', panFilter ? '[panned]' : '[out]',
      '-vn',
      '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', tmpPath
    ]
  }

  await runFfmpegToFile(args)
  await renameWithRetry(tmpPath, outputPath)
}

// Convolves a rendered .wav (already filters/speedPitch-baked, pre-crossfade)
// with a synthetic reverb impulse response, dry+wet mixed and trimmed back to
// its own original duration - see getOrCreateReverbIR for the IR itself.
//
// afir's own `dry`/`wet` options turned out NOT to be a dry/wet *mix* at all
// despite the name - confirmed directly against the real bundled binary
// before writing this (per this project's standing discipline): both are
// just two gain stages multiplied into the *same* always-fully-convolved
// output (dry=1,wet=0 produced total silence, not a dry passthrough; level
// scaled with dry*wet's product, not a crossfade). A real dry/wet blend is
// built by hand instead - split the input, run only the wet branch through
// afir (dry=1:wet=1, i.e. unmodified by afir's own gains), scale each
// branch by the desired mix, then sum. `alimiter` (ceiling only, matching
// Composite's own identical brick-wall-limiter use, v0.1.113) guards against
// a sustained ambient sound's reverb tail building up real level over the
// mix - measured directly: a continuous tone at mix 0.5+ was already
// clipping-adjacent before this was added.
// Exported (2026-09-06) so exportMix.js's whole-mix/group post-processing
// can reuse this exact reverb pass for a preset's or Sound Group's own
// reverb setting, instead of a second, duplicated implementation - same
// directory, no plugin-boundary duplication needed (mirrors
// buildEqBandFilter's/buildEchoFilter's own already-established export
// reasoning above). Already bakes in the brick-wall limiter (see this
// function's own doc comment) - a caller doesn't need to add another one on
// top of this pass's own output.
// Bakes the Volume envelope (per-sound, Loop mode, v1 - see
// volumeEnvelope.js's own doc comment for why this is a WAV+amultiply pass,
// not an asendcmd one) into the loop clip - same "own isolated pass" shape
// as applyReverbPass just above (a second ffmpeg input, so it can't join
// buildFilterChain's plain comma -af fragment), reads its own input's
// duration rather than trusting a value the caller might have measured
// against different audio (matches applyReverbPass's own self-contained
// convention).
async function applyVolumeEnvelopePass(inputPath, outputPath, volumeEnvelope) {
  const duration = readWavDuration(inputPath)
  const envPath = renderVolumeEnvelopeWav(volumeEnvelope, duration)
  try {
    await runFfmpegToFile([
      '-y', '-i', inputPath, '-i', envPath,
      '-filter_complex',
      '[1:a]aresample=44100,aformat=channel_layouts=stereo:sample_fmts=fltp[env];' +
        '[0:a]aformat=channel_layouts=stereo:sample_fmts=fltp[sig];' +
        '[sig][env]amultiply[out]',
      '-map', '[out]',
      '-t', duration.toFixed(6),
      '-vn', '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', outputPath
    ])
  } finally {
    if (fs.existsSync(envPath)) {
      try {
        fs.unlinkSync(envPath)
      } catch {
        // best-effort cleanup
      }
    }
  }
}

export async function applyReverbPass(inputPath, outputPath, reverbSizeMs, reverbMix) {
  const irPath = await getOrCreateReverbIR(reverbSizeMs / 1000)
  const mix = Math.max(0, Math.min(1, reverbMix))
  const dryGain = (1 - mix).toFixed(4)
  const wetGain = mix.toFixed(4)
  const duration = readWavDuration(inputPath)
  await runFfmpegToFile([
    '-y', '-i', inputPath, '-i', irPath,
    '-filter_complex',
    `[0]asplit=2[rvdry][rvwet];` +
      `[rvwet][1]afir=dry=1:wet=1:gtype=none[rvwetraw];` +
      `[rvdry]volume=${dryGain}[rvdryout];` +
      `[rvwetraw]volume=${wetGain}[rvwetout];` +
      `[rvdryout][rvwetout]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=disabled[out]`,
    '-map', '[out]',
    '-t', duration.toFixed(6),
    '-vn', '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', outputPath
  ])
}

async function doRender({ id, inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch, outputPath: explicitOutputPath }) {
  const outputPath = explicitOutputPath ?? getLoopClipPath(id)
  const tmpPath = `${outputPath}.tmp`
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  const speedPitchChain = buildSpeedPitchReverseChain(speedPitch, loopEnd - loopStart)
  // Reverb (afir convolution) needs a second ffmpeg *input* (the impulse
  // response) - it can't join buildFilterChain's plain comma-separated -af
  // fragment the way highpass/lowpass/echo/EQ do, so it always needs its own
  // isolated pass, same as speed/pitch/reverse - see the pre-pass branch
  // below and applyReverbPass above.
  const reverbActive = Boolean(filters?.reverbMix > 0 && filters?.reverbSizeMs > 0)
  // Noise reduction (afftdn + a sample_noise asendcmd cue) also forces the
  // pre-processing pass: its asendcmd timestamps only line up on a single
  // linear read of the trimmed region, not the three separate tail/head/main
  // reads renderCrossfadedLoop does. Building it measures the noise region
  // (one short decode) so it's resolved once here, before the fast-path check.
  const noiseChain = await buildNoiseReductionChain(inputPath, filters, loopStart, loopEnd)
  // Volume envelope (v1, Loop mode) also forces the pre-processing pass -
  // like reverb, amultiply-ing a control-signal WAV against the audio needs
  // a second ffmpeg input, so it can't join buildFilterChain's plain -af
  // fragment either. hasVolumeEnvelope already filters out "enabled but
  // still the flat neutral default" so a freshly-toggled-on-but-untouched
  // envelope doesn't force the slow path for nothing.
  const envelopeActive = hasVolumeEnvelope(filters?.volumeEnvelope)

  if (!speedPitchChain && !reverbActive && !noiseChain && !envelopeActive) {
    try {
      await renderCrossfadedLoop({ inputPath, loopStart, loopEnd, filters, crossfadeSeconds, pan: filters?.pan, outputPath })
      return { ok: true }
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          // best-effort cleanup
        }
      }
      console.error('renderLoopClip failed', id, err)
      return { ok: false, error: err.message }
    }
  }

  // BUG FIX, caught during verification before this ever shipped: applying
  // rubberband/areverse *after* the crossfade stage (i.e. as the
  // very last step) left a real, measurable seam - worse than the seam this
  // whole crossfade system exists to remove. rubberband processes whatever
  // buffer it's handed as a bounded clip with its own internal windowed
  // (FFT-based) analysis, which has edge effects at the very start/end of
  // that buffer; doing it last put those fresh edge effects exactly at the
  // wrap point the crossfade had just finished smoothing. Confirmed by
  // measuring the actual sample-level wrap discontinuity both ways on real
  // (non-synthetic) audio: applying speed/pitch/reverse after crossfading
  // left a gap proportionally *larger* than the original pre-crossfade bug
  // this feature's sibling fixes (v0.1.22/v0.1.26/v0.1.27) exist to solve;
  // reordering to pre-process first, THEN crossfade, brought it back down to
  // within the same range as ordinary sample-to-sample variation elsewhere
  // in the same file (an ~8/32768 residual vs. ~192/32768 the other way
  // around, on identical content) - because the crossfade's whole job is
  // hiding exactly this kind of discontinuity, regardless of what caused it,
  // as long as it runs *last*.
  const tmpIntermediatePath = `${outputPath}.pre.tmp.wav`
  const tmpReverbPath = `${outputPath}.reverb.tmp.wav`
  const tmpEnvelopePath = `${outputPath}.envelope.tmp.wav`
  try {
    const filterChain = buildFilterChain(filters)
    // Noise reduction runs first - it should subtract the sampled noise
    // profile from the raw trimmed source, before highpass/EQ/gate colour it
    // (afftdn's profile was measured against that same unshaped signal).
    const preChain = [noiseChain, filterChain, speedPitchChain].filter(Boolean).join(',')
    await runFfmpegToFile([
      '-y',
      '-ss', loopStart.toFixed(6), '-t', (loopEnd - loopStart).toFixed(6), '-i', inputPath,
      ...(preChain ? ['-af', preChain] : []),
      '-vn',
      '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', tmpIntermediatePath
    ])
    // Reverb runs as its own isolated pass, same "pre-process first, THEN
    // crossfade" reasoning as speed/pitch/reverse above - it's linear/time-
    // invariant so it can't reintroduce the class of edge-effect seam
    // rubberband did, but doing it before the crossfade still means the
    // convolution's own start-of-buffer warm-up settles against real
    // preceding audio (this clip's own tail-adjacent content) rather than
    // digital silence.
    let sourceForCrossfade = tmpIntermediatePath
    if (reverbActive) {
      await applyReverbPass(tmpIntermediatePath, tmpReverbPath, filters.reverbSizeMs, filters.reverbMix)
      sourceForCrossfade = tmpReverbPath
    }
    // Runs last among the pre-passes (after reverb, still before the crossfade) -
    // shaping the reverb's own wet tail along with the dry signal reads as
    // the natural, expected result of "this sound gets quieter here" (an
    // engineer's own volume automation is normally the very last stage
    // before a render, after everything else already applied). Must still
    // run before renderCrossfadedLoop's crossfade, same reason noise
    // reduction/speed-pitch do - the envelope's own timeline only lines up
    // with a single linear read of the trimmed region, not the three split reads.
    if (envelopeActive) {
      await applyVolumeEnvelopePass(sourceForCrossfade, tmpEnvelopePath, filters.volumeEnvelope)
      sourceForCrossfade = tmpEnvelopePath
    }
    const intermediateDuration = readWavDuration(sourceForCrossfade)
    // filters were already baked into the intermediate above - passing null
    // here avoids applying them a second time.
    await renderCrossfadedLoop({
      inputPath: sourceForCrossfade,
      loopStart: 0,
      loopEnd: intermediateDuration,
      filters: null,
      crossfadeSeconds,
      pan: filters?.pan,
      outputPath
    })
    return { ok: true }
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // best-effort cleanup
      }
    }
    console.error('renderLoopClip (speed/pitch/reverse/reverb/envelope) failed', id, err)
    return { ok: false, error: err.message }
  } finally {
    if (fs.existsSync(tmpReverbPath)) {
      try {
        fs.unlinkSync(tmpReverbPath)
      } catch {
        // best-effort cleanup
      }
    }
    if (fs.existsSync(tmpEnvelopePath)) {
      try {
        fs.unlinkSync(tmpEnvelopePath)
      } catch {
        // best-effort cleanup
      }
    }
    if (fs.existsSync(tmpIntermediatePath)) {
      try {
        fs.unlinkSync(tmpIntermediatePath)
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// Renders [loopStart, loopEnd) with filters/speedPitch/crossfade baked in to
// an arbitrary caller-supplied path instead of the sound's own id-keyed
// managed clip slot - used by the Export feature (exportMix.js) to build
// throwaway per-sound/per-shot tracks without disturbing a sound's real
// cached buffer-mode clip. Shares doRender's exact same logic (filter chain,
// speed/pitch/reverse pre-pass ordering, crossfade), not a parallel
// reimplementation - and deliberately bypasses the `pending` id-keyed dedup
// map above, which exists to collapse concurrent Saves of the *same sound*,
// not relevant for one-off exports to their own unique temp paths.
export function renderClipToPath({ inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch, outputPath }) {
  return doRender({ id: null, inputPath, loopStart, loopEnd, filters, crossfadeSeconds, speedPitch, outputPath })
}

export function deleteLoopClip(id) {
  const outputPath = getLoopClipPath(id)
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
  const tmpPath = `${outputPath}.tmp`
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
}
