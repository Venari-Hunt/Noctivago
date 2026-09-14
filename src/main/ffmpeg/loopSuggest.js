import { runFfmpegPipe } from './runFfmpeg.js'

// Suggests a (loopStart, loopEnd) pair for a sound - the "Suggest a loop
// point" button in the Remix plugin. Analysis-only: it never renders or
// bakes anything, it just proposes numbers the user can accept or edit. The
// existing crossfade-rotation bake (loopClip.js) still does the actual
// seam-smoothing work on whatever region ends up saved.
//
// Approach (researched first - see noctivago_task_list memory): prior art
// like PyMusicLooper / LoopAuditioneer targets *musical* content and leans
// on beat/pitch periodicity. Noctívago's typical sounds are rain / wind /
// forest / crowd - non-tonal textures with no periodic structure to phase-
// align. For that content the perceptually relevant cue at a loop seam is
// energy-envelope continuity, not sample-level phase. So this works on a
// cheap per-frame energy envelope (full-band RMS + a low/high split from a
// one-pole filter, for a bit more texture discrimination) rather than raw
// samples - which also keeps memory flat regardless of file length, the
// same reason waveformPeaks.js reduces to peaks as it streams instead of
// buffering decoded audio.

const SAMPLE_RATE = 22050
const FRAME_SECONDS = 0.02
const FRAME_SAMPLES = Math.round(SAMPLE_RATE * FRAME_SECONDS) // 441
// One-pole lowpass cutoff for the low/high energy split.
const SPLIT_HZ = 500
const SPLIT_A = 1 - Math.exp((-2 * Math.PI * SPLIT_HZ) / SAMPLE_RATE)

// Loop-length preference. The search is constrained to [minLoop, maxLoop]
// seconds (both clamped to the file), and among candidates a longer loop is
// mildly preferred (LENGTH_WEIGHT) since a longer region gives the texture
// more room to line up naturally and reads as less obviously repetitive -
// but only mildly, so it never picks a much worse seam just for length.
const DEFAULT_MIN_LOOP_SECONDS = 12
const DEFAULT_MAX_LOOP_SECONDS = 75
const LENGTH_WEIGHT = 0.02
// Files at or below this don't get a suggestion - they're short enough to
// just loop whole, and there's no room to pick a meaningful sub-region.
const MIN_ANALYZABLE_SECONDS = 5
// Keep the seam away from the very start/end, where decode edge effects and
// fade-ins live.
const EDGE_MARGIN_SECONDS = 0.15

// Comparison half-window around each candidate seam, in fine frames (0.5s).
const FINE_W = 25
// Coarse comparison half-window, in *coarse* frames.
const COARSE_W = 6
// Stage-1 coarse search runs on an envelope downsampled to ~this many
// frames, so its cost is bounded no matter how long the file is; stage 2
// then refines the winner at full frame resolution.
const COARSE_TARGET_FRAMES = 2000
// If the coarse (start,end) grid would exceed this many pairs, stage 1 uses
// a wider stride (and stage 2's refine window widens to match) - keeps the
// whole analysis at roughly a couple of seconds even for a short file whose
// loop-length range covers most of it.
const COARSE_PAIR_BUDGET = 800_000
// Stage 2 never refines further than this many fine frames from the coarse
// winner. On a multi-hour file the coarse cell can be tens of seconds wide;
// past a few seconds of refinement the extra precision isn't audible for
// looping ambience and the crossfade bake absorbs the rest.
const MAX_REFINE_FRAMES = 250

// Decodes the whole file to mono PCM once and reduces it to per-frame
// [fullRms, lowRms, highRms] with flat memory. `lp` carries the one-pole
// filter state across chunk boundaries.
async function extractEnvelope(inputPath) {
  const full = []
  const low = []
  const high = []
  let frameSumSq = 0
  let frameLowSumSq = 0
  let frameCount = 0
  let lp = 0
  let leftover = Buffer.alloc(0)

  const pushFrame = () => {
    const f = Math.sqrt(frameSumSq / FRAME_SAMPLES)
    const l = Math.sqrt(frameLowSumSq / FRAME_SAMPLES)
    full.push(f)
    low.push(l)
    high.push(Math.sqrt(Math.max(0, f * f - l * l)))
    frameSumSq = 0
    frameLowSumSq = 0
    frameCount = 0
  }

  await runFfmpegPipe(
    ['-i', inputPath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
    (chunk) => {
      const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
      const usable = combined.length - (combined.length % 2)
      leftover = combined.subarray(usable)
      for (let i = 0; i < usable; i += 2) {
        const s = combined.readInt16LE(i) / 32768
        lp += SPLIT_A * (s - lp)
        frameSumSq += s * s
        frameLowSumSq += lp * lp
        if (++frameCount === FRAME_SAMPLES) pushFrame()
      }
    }
  )
  if (frameCount > 0) {
    // Pad the trailing partial frame so its RMS isn't inflated by the short
    // divisor.
    frameSumSq *= FRAME_SAMPLES / frameCount
    frameLowSumSq *= FRAME_SAMPLES / frameCount
    frameCount = FRAME_SAMPLES
    pushFrame()
  }
  return { full, low, high }
}

function median(arr) {
  if (arr.length === 0) return 1
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = sorted[sorted.length >> 1]
  return mid > 0 ? mid : 1
}

// Normalizes each feature stream by its own median so the seam distance is
// comparable across files of any absolute level, while still preserving
// relative level differences *within* a file (a real loudness jump at the
// seam should still cost something).
function normalize(env) {
  const mf = median(env.full)
  const ml = median(env.low)
  const mh = median(env.high)
  return {
    full: env.full.map((v) => v / mf),
    low: env.low.map((v) => v / ml),
    high: env.high.map((v) => v / mh)
  }
}

function downsample(env, factor) {
  if (factor <= 1) return env
  const reduce = (arr) => {
    const out = []
    for (let i = 0; i < arr.length; i += factor) {
      let sum = 0
      let n = 0
      for (let j = i; j < i + factor && j < arr.length; j++) {
        sum += arr[j]
        n++
      }
      out.push(sum / n)
    }
    return out
  }
  return { full: reduce(env.full), low: reduce(env.low), high: reduce(env.high) }
}

// Triangular weights (centre frame matters most - that's the actual seam)
// over [-w, w].
function triangleWeights(w) {
  const weights = new Float64Array(2 * w + 1)
  let total = 0
  for (let k = -w; k <= w; k++) {
    const val = 1 - Math.abs(k) / (w + 1)
    weights[k + w] = val
    total += val
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= total
  return weights
}

// Sum of weighted per-frame feature distance between the neighbourhood of
// frame `a` and frame `b`. Lower = the two points look more alike, i.e. the
// jump from just-before-b back to a would be less audible.
function seamCost(env, a, b, w, weights) {
  const n = env.full.length
  if (a - w < 0 || b + w >= n) return Infinity
  let cost = 0
  for (let k = -w; k <= w; k++) {
    const ia = a + k
    const ib = b + k
    cost +=
      weights[k + w] *
      (Math.abs(env.full[ia] - env.full[ib]) +
        Math.abs(env.low[ia] - env.low[ib]) +
        Math.abs(env.high[ia] - env.high[ib]))
  }
  return cost
}

function bestPairInRange(env, {
  minLoopFrames,
  maxLoopFrames,
  startLo,
  startHi,
  endLoOffset,
  endHiOffset,
  step,
  w,
  frameSeconds
}) {
  const weights = triangleWeights(w)
  const n = env.full.length
  let best = null
  for (let s = startLo; s <= startHi; s += step) {
    const eFrom = Math.max(s + minLoopFrames, s + endLoOffset)
    const eTo = Math.min(n - w - 1, s + maxLoopFrames, s + endHiOffset)
    for (let e = eFrom; e <= eTo; e += step) {
      const cost = seamCost(env, s, e, w, weights)
      if (!Number.isFinite(cost)) continue
      const total = cost - LENGTH_WEIGHT * (e - s) * frameSeconds
      if (!best || total < best.total) best = { s, e, cost, total }
    }
  }
  return best
}

export async function suggestLoopPoints(inputPath, durationSeconds, options = {}) {
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null
  if (duration != null && duration <= MIN_ANALYZABLE_SECONDS) {
    return { ok: true, wholeFile: true, loopStart: 0, loopEnd: duration }
  }

  const rawEnv = await extractEnvelope(inputPath)
  const nFrames = rawEnv.full.length
  const totalSeconds = duration ?? nFrames * FRAME_SECONDS
  if (nFrames < FINE_W * 4 || totalSeconds <= MIN_ANALYZABLE_SECONDS) {
    return { ok: true, wholeFile: true, loopStart: 0, loopEnd: totalSeconds }
  }

  const env = normalize(rawEnv)

  const minLoopSeconds = Math.min(
    options.minLoopSeconds ?? DEFAULT_MIN_LOOP_SECONDS,
    totalSeconds * 0.4
  )
  const maxLoopSeconds = Math.min(
    options.maxLoopSeconds ?? DEFAULT_MAX_LOOP_SECONDS,
    totalSeconds - 2 * EDGE_MARGIN_SECONDS
  )
  const minLoopFrames = Math.max(1, Math.round(minLoopSeconds / FRAME_SECONDS))
  const maxLoopFrames = Math.max(minLoopFrames + 1, Math.round(maxLoopSeconds / FRAME_SECONDS))
  const edgeFrames = Math.round(EDGE_MARGIN_SECONDS / FRAME_SECONDS)

  // Stage 1: coarse search over a length-bounded downsampled envelope.
  const coarseFactor = Math.max(1, Math.ceil(nFrames / COARSE_TARGET_FRAMES))
  const coarse = downsample(env, coarseFactor)
  const coarseFrameSeconds = FRAME_SECONDS * coarseFactor
  const minLoopCoarse = Math.max(1, Math.floor(minLoopFrames / coarseFactor))
  const maxLoopCoarse = Math.ceil(maxLoopFrames / coarseFactor)
  const approxPairs = coarse.full.length * Math.max(1, maxLoopCoarse - minLoopCoarse)
  const coarseStep = Math.max(1, Math.ceil(Math.sqrt(approxPairs / COARSE_PAIR_BUDGET)))
  const coarseBest = bestPairInRange(coarse, {
    minLoopFrames: minLoopCoarse,
    maxLoopFrames: maxLoopCoarse,
    startLo: Math.max(COARSE_W, Math.floor(edgeFrames / coarseFactor)),
    startHi: coarse.full.length - COARSE_W - 1,
    endLoOffset: 0,
    endHiOffset: Infinity,
    step: coarseStep,
    w: COARSE_W,
    frameSeconds: coarseFrameSeconds
  })
  if (!coarseBest) {
    return { ok: true, wholeFile: true, loopStart: 0, loopEnd: totalSeconds }
  }

  // Stage 2: refine the winner at full frame resolution, within one coarse
  // grid cell (coarseFactor * coarseStep fine frames) either way of each
  // endpoint - capped so a very wide coarse cell can't blow up the search.
  const s0 = coarseBest.s * coarseFactor
  const e0 = coarseBest.e * coarseFactor
  // At least a full fine window of slack, so stage 2 (which scores with the
  // wider FINE_W) can actually move to that window's own optimum even when
  // stage 1's narrower COARSE_W landed a little off.
  const refine = Math.min(
    MAX_REFINE_FRAMES,
    Math.max(2 * FINE_W, coarseFactor * coarseStep + coarseFactor)
  )
  const fine = bestPairInRange(env, {
    minLoopFrames,
    maxLoopFrames,
    startLo: Math.max(FINE_W, edgeFrames, s0 - refine),
    startHi: Math.min(nFrames - FINE_W - 1, s0 + refine),
    // e is searched relative to s; the coarse winner's own end sat ~(e0-s0)
    // frames past its start, so refine within `refine` of that offset.
    endLoOffset: e0 - s0 - refine,
    endHiOffset: e0 - s0 + refine,
    step: 1,
    w: FINE_W,
    frameSeconds: FRAME_SECONDS
  })

  const winner = fine ?? { s: s0, e: e0 }
  const loopStart = Math.max(0, Math.min(totalSeconds, +(winner.s * FRAME_SECONDS).toFixed(3)))
  const loopEnd = Math.max(loopStart, Math.min(totalSeconds, +(winner.e * FRAME_SECONDS).toFixed(3)))

  return { ok: true, wholeFile: false, loopStart, loopEnd }
}
