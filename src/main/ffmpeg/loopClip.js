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
const CROSSFADE_SECONDS = 0.03

function clipsDir() {
  return path.join(app.getPath('userData'), 'clips')
}

export function getLoopClipPath(id) {
  return path.join(clipsDir(), `${id}.wav`)
}

// Builds an ffmpeg filter chain fragment from a {highpassHz, lowpassHz,
// gainDb} filter set, skipping any band left at its neutral/no-op value.
// Returns null if every band is neutral (nothing to apply).
function buildFilterChain(filters) {
  if (!filters) return null
  const parts = []
  if (filters.highpassHz > 0) parts.push(`highpass=f=${filters.highpassHz}`)
  if (filters.lowpassHz > 0 && filters.lowpassHz < 20000) parts.push(`lowpass=f=${filters.lowpassHz}`)
  if (filters.gainDb) parts.push(`volume=${filters.gainDb}dB`)
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
function buildFilterComplex(filters, fade) {
  const filterChain = buildFilterChain(filters)
  const suffix = filterChain ? `,${filterChain}` : ''

  return [
    `[0:a:0]anull${suffix}[mainF]`,
    `[1:a:0]anull${suffix}[tailF]`,
    `[2:a:0]anull${suffix}[headF]`,
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
    '-filter_complex', buildFilterComplex(filters, fade.toFixed(6)),
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
