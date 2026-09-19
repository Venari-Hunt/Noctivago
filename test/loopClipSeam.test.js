import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// loopClip.js imports `app` from electron only to find userData. Under plain
// `node --test` that import is redirected to a stub whose getPath points at a
// temp folder, so the real render (and the real bundled ffmpeg) runs.
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
// Source sample value = source time * SLOPE, so a jump between two decoded
// samples reads directly as a jump in source time.
const SLOPE = 0.05

let userData
let source
let renderLoopClip

function decodeMono(file) {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

function worstJumpSeconds(samples) {
  let worst = Math.abs(samples[0] - samples[samples.length - 1])
  for (let i = 1; i < samples.length; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]))
  return worst / SLOPE
}

describe('renderLoopClip seam', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, () => {
  before(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-seam-'))
    process.env.NOCTIVAGO_TEST_USERDATA = userData
    source = path.join(userData, 'ramp.wav')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=t*${SLOPE}:s=${RATE}:d=12`, '-c:a', 'pcm_f32le', source])
    ;({ renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js'))
  })

  after(() => fs.rmSync(userData, { recursive: true, force: true }))

  // Regression (v0.1.221): the blend used to end on source time S+fade while
  // the clip wrapped back to S, a jump of `fade` seconds on every loop.
  for (const [i, c] of [
    { loopStart: 0, loopEnd: 12, crossfadeSeconds: 0.2 },
    { loopStart: 2, loopEnd: 9, crossfadeSeconds: 1 },
    { loopStart: 0, loopEnd: 12, crossfadeSeconds: 0.5, filters: { pan: 0.5 } },
    { loopStart: 1, loopEnd: 3, crossfadeSeconds: 2 },
    // Regression (v0.1.222): each segment is filtered separately, so without
    // a pre-roll a lowpass restarted from silence at every join.
    { loopStart: 2, loopEnd: 9, crossfadeSeconds: 1, filters: { lowpassHz: 2000 } },
    { loopStart: 0, loopEnd: 9, crossfadeSeconds: 1, filters: { lowpassHz: 2000, eq: [{ type: 'peaking', freqHz: 500, gainDb: 6, q: 1 }] } }
  ].entries()) {
    test(`no jump anywhere, wrap included: ${JSON.stringify(c)}`, async () => {
      const result = await renderLoopClip({ id: `seam${i}`, inputPath: source, speedPitch: null, filters: {}, ...c })
      assert.equal(result.ok, true)
      const samples = decodeMono(path.join(userData, 'clips', `seam${i}.wav`))
      const trim = c.loopEnd - c.loopStart
      const fade = Math.min(c.crossfadeSeconds, trim / 4)
      assert.ok(Math.abs(samples.length / RATE - (trim - fade)) < 0.002, `length ${samples.length / RATE}`)
      assert.ok(worstJumpSeconds(samples) < 0.01, `jump ${worstJumpSeconds(samples)}s`)
      // The clip starts (and ends) on the trim's midpoint, so the edit and
      // its crossfade sit mid-clip. (A lowpass delays the ramp slightly.)
      if (!c.filters) {
        const start = samples[0] / SLOPE
        assert.ok(Math.abs(start - (c.loopStart + c.loopEnd) / 2) < 0.002, `start ${start}`)
      }
    })
  }

  // Regression (v0.1.223): an overlapping request with different settings
  // used to get the in-flight render's result, leaving the old pan on disk.
  test('overlapping renders of one sound finish with the last request on disk', async () => {
    const base = { id: 'queue', inputPath: source, loopStart: 1, loopEnd: 9, crossfadeSeconds: 0.2, speedPitch: null }
    const hardLeft = { ...base, filters: { pan: -1 } }
    const first = renderLoopClip(hardLeft)
    assert.equal(renderLoopClip(hardLeft), first, 'an identical request joins the one in flight')
    const second = renderLoopClip({ ...base, filters: { pan: 1 } })
    const results = await Promise.all([first, second])
    assert.deepEqual(results.map((r) => r.ok), [true, true])
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', path.join(userData, 'clips', 'queue.wav'), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
    const stereo = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
    let left = 0
    let right = 0
    for (let i = 0; i < stereo.length; i += 2) {
      left += Math.abs(stereo[i])
      right += Math.abs(stereo[i + 1])
    }
    assert.ok(left < right * 0.01, `hard right expected, got L=${left} R=${right}`)
  })

  test('crossfade 0 is a plain trim of the full length', async () => {
    const result = await renderLoopClip({ id: 'seam-off', inputPath: source, loopStart: 1, loopEnd: 5, filters: {}, crossfadeSeconds: 0 })
    assert.equal(result.ok, true)
    const samples = decodeMono(path.join(userData, 'clips', 'seam-off.wav'))
    assert.ok(Math.abs(samples.length / RATE - 4) < 0.002)
    assert.ok(Math.abs(samples[0] / SLOPE - 1) < 0.001)
  })
})
