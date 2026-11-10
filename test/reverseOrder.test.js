import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Same electron stub as loopClipSeam.test.js, so the real render and the
// real bundled ffmpeg run under plain `node --test`.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
      if (spec === 'electron') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const app = { getPath: () => process.env.NOCTIVAGO_TEST_USERDATA, isPackaged: false }') }
      }
      return next(spec, ctx)
    }`)
)

const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const RATE = 44100

function decodeMono(file) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

// Loudest absolute sample within +-20 ms of `centre` (wrapping, since the
// clip is a loop that starts mid-trim).
function peakNear(samples, centre) {
  const half = Math.round(0.02 * RATE)
  let peak = 0
  for (let i = centre - half; i <= centre + half; i++) {
    const j = ((i % samples.length) + samples.length) % samples.length
    peak = Math.max(peak, Math.abs(samples[j]))
  }
  return peak
}

describe('Reverse in the saved clip matches the live preview', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, () => {
  let userData
  let source
  let renderLoopClip

  before(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-reverse-'))
    process.env.NOCTIVAGO_TEST_USERDATA = userData
    source = path.join(userData, 'click.wav')
    // 4 s of silence with one 2 ms click at 1 s.
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=0.9*lt(abs(t-1)\\,0.001):s=${RATE}:d=4`, '-c:a', 'pcm_f32le', source])
    ;({ renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js'))
  })

  after(() => fs.rmSync(userData, { recursive: true, force: true }))

  // Remix plays a reversed copy of the loop through its filter chain, so an
  // echo repeats AFTER each reversed sound. v0.1.275 moved the save's
  // reverse ahead of the filters to match; before, the echo was reversed
  // too and swelled in BEFORE the click.
  test('echo follows the reversed click instead of leading into it', async () => {
    const result = await renderLoopClip({
      id: 'reverse-echo',
      inputPath: source,
      loopStart: 0,
      loopEnd: 4,
      crossfadeSeconds: 0.02,
      speedPitch: { speed: 1, pitchSemitones: 0, reversed: true },
      filters: { echoDelayMs: 500, echoDecay: 0.5 }
    })
    assert.equal(result.ok, true, result.error)
    const samples = decodeMono(path.join(userData, 'clips', 'reverse-echo.wav'))
    let click = 0
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i]) > Math.abs(samples[click])) click = i
    const half = Math.round(0.5 * RATE)
    const after = peakNear(samples, click + half)
    const before = peakNear(samples, click - half)
    assert.ok(after > 0.1, `echo after the click: ${after}`)
    assert.ok(before < 0.01, `nothing before the click: ${before}`)
  })
})
