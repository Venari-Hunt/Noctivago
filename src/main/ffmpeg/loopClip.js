import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { runFfmpegToFile } from './runFfmpeg.js'

const pending = new Map()

// Length of the self-crossfade blended into the tail of every rendered clip
// (see buildFilterComplex) so the loop seam has no hard discontinuity, even
// when the audio content itself doesn't naturally repeat. Clamped per-clip
// against the clip's own duration so this never misbehaves on a very short
// trim.
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
const CROSSFADE_SECONDS = 0.2

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

function buildEchoFilter(delayMs, decay) {
  const delays = []
  const decays = []
  for (let i = 1; i <= ECHO_TAPS; i++) {
    delays.push(Math.round(delayMs * i))
    decays.push((decay ** i).toFixed(4))
  }
  return `aecho=1.0:1.0:${delays.join('|')}:${decays.join('|')}`
}

// Builds an ffmpeg filter chain fragment from a {highpassHz, lowpassHz,
// gainDb, echoDelayMs, echoDecay} filter set, skipping any band left at its
// neutral/no-op value. Returns null if every band is neutral (nothing to
// apply).
function buildFilterChain(filters) {
  if (!filters) return null
  const parts = []
  if (filters.highpassHz > 0) parts.push(`highpass=f=${filters.highpassHz}`)
  if (filters.lowpassHz > 0 && filters.lowpassHz < 20000) parts.push(`lowpass=f=${filters.lowpassHz}`)
  if (filters.gainDb) parts.push(`volume=${filters.gainDb}dB`)
  if (filters.echoDelayMs > 0 && filters.echoDecay > 0) parts.push(buildEchoFilter(filters.echoDelayMs, filters.echoDecay))
  return parts.length > 0 ? parts.join(',') : null
}

// Builds the filter_complex graph that crossfades the clip's own tail into
// its own head, given three separate reads of the same source (see
// doRender): input 0 is the main body (everything except the last `fade`
// seconds), input 1 is just the tail (last `fade` seconds), input 2 is just
// the head (first `fade` seconds). The tail and head get blended via
// acrossfade, then reattached after the main body — output duration is
// unchanged. Any saved filters are applied to each of the three reads
// identically, so the whole clip is filtered consistently.
//
// This *must* stay three separate ffmpeg inputs rather than one input
// split+trimmed internally (asplit/atrim on a single stream) — that was
// tried first and silently produced a near-empty crossfade: ffmpeg's link
// labels can only be consumed once, and even after fixing that with a
// second asplit, feeding acrossfade two atrim'd sub-streams at exactly its
// crossfade duration produced truncated output for reasons that didn't
// repro with genuinely separate inputs. Verified directly against ffmpeg
// before landing this — don't "simplify" back to a single-input graph
// without re-verifying against real output duration, not just exit code 0.
// atrim after the filter chain matters specifically for echo: aecho extends
// its output past the input's own length to fit the echo tail (confirmed
// directly against the bundled binary - a 2s input became ~4s of output),
// which would silently desync acrossfade/concat's exact-duration
// assumptions below. Trimming each fragment back to its own original
// length is also musically correct on its own terms, not just a technical
// workaround: this is a *looping* clip, so any echo tail that would have
// bled past the loop point gets hard-cut by the loop wrap regardless -
// better to trim it deliberately here than leave it to an undefined,
// unverified interaction with the crossfade seam.
function buildFilterComplex(filters, fade, mainDuration) {
  const filterChain = buildFilterChain(filters)
  const suffix = filterChain ? `,${filterChain}` : ''

  return [
    `[0:a:0]anull${suffix},atrim=start=0:end=${mainDuration}[mainF]`,
    `[1:a:0]anull${suffix},atrim=start=0:end=${fade}[tailF]`,
    `[2:a:0]anull${suffix},atrim=start=0:end=${fade}[headF]`,
    `[tailF][headF]acrossfade=d=${fade}:c1=tri:c2=tri[blended]`,
    `[mainF][blended]concat=n=2:v=0:a=1[out]`
  ].join(';')
}

// Renders just [loopStart, loopEnd) of inputPath — with any filters baked
// in — into its own small WAV file, so it can be fully decoded client-side
// for native, sample-accurate looping instead of streaming the (possibly
// huge) original with an approximate seek-back loop. Never throws — callers
// get {ok:false, error} instead, so a failed render can't block saving the
// loop points/filters themselves.
export function renderLoopClip({ id, inputPath, loopStart, loopEnd, filters }) {
  if (pending.has(id)) return pending.get(id)

  const promise = doRender({ id, inputPath, loopStart, loopEnd, filters }).finally(() => pending.delete(id))
  pending.set(id, promise)
  return promise
}

async function doRender({ id, inputPath, loopStart, loopEnd, filters }) {
  const outputPath = getLoopClipPath(id)
  const tmpPath = `${outputPath}.tmp`
  fs.mkdirSync(clipsDir(), { recursive: true })

  const duration = loopEnd - loopStart
  const fade = Math.min(CROSSFADE_SECONDS, duration / 4)
  const mainDuration = duration - fade

  const args = [
    '-y',
    '-ss', loopStart.toFixed(6), '-t', mainDuration.toFixed(6), '-i', inputPath,
    '-ss', (loopEnd - fade).toFixed(6), '-t', fade.toFixed(6), '-i', inputPath,
    '-ss', loopStart.toFixed(6), '-t', fade.toFixed(6), '-i', inputPath,
    '-filter_complex', buildFilterComplex(filters, fade.toFixed(6), mainDuration.toFixed(6)),
    '-map', '[out]',
    '-vn',
    '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav', tmpPath
  ]

  try {
    await runFfmpegToFile(args)
    fs.renameSync(tmpPath, outputPath)
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

export function deleteLoopClip(id) {
  const outputPath = getLoopClipPath(id)
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
  const tmpPath = `${outputPath}.tmp`
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
}
