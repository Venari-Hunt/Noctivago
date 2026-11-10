import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Same electron stub as loopClipSeam.test.js: loopClip.js and runFfmpeg.js
// only need `app` for userData / isPackaged.
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
function freqOf(x, from, to) {
  let z = 0
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE) - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) z++
  return z / (to - from)
}

let dir
let source
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-pitch-'))
  process.env.NOCTIVAGO_TEST_USERDATA = dir
  source = path.join(dir, 'tone.wav')
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=f=500:d=8:r=${RATE}`, '-c:a', 'pcm_s16le', source])
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('renderLoopClip saves Pitch +12 as double the frequency at the same length', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, async () => {
  const { renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js')
  const result = await renderLoopClip({ id: 'pitch', inputPath: source, loopStart: 0, loopEnd: 6, crossfadeSeconds: 0.1, speedPitch: { speed: 1, pitchSemitones: 12 }, filters: {} })
  assert.equal(result.ok, true, result.error)
  const clip = decodeMono(path.join(dir, 'clips', 'pitch.wav'))
  assert.ok(Math.abs(clip.length / RATE - 5.9) < 0.3, 'length ' + clip.length / RATE)
  assert.ok(Math.abs(freqOf(clip, 2, 4) - 1000) < 15)
})

test('renderLoopClip saves Speed 2 as half the length and Reverse flips Doppler', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, async () => {
  const { renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js')
  const fast = await renderLoopClip({ id: 'fast', inputPath: source, loopStart: 0, loopEnd: 6, crossfadeSeconds: 0.1, speedPitch: { speed: 2, pitchSemitones: 0 }, filters: {} })
  assert.equal(fast.ok, true, fast.error)
  const fastClip = decodeMono(path.join(dir, 'clips', 'fast.wav'))
  assert.ok(Math.abs(fastClip.length / RATE - 2.9) < 0.3, 'length ' + fastClip.length / RATE)
  assert.ok(Math.abs(freqOf(fastClip, 1, 2) - 500) < 10)
  // Reverse flips Doppler's bend. The loop's crossfade rotates where the clip
  // starts, so compare the two clips against each other instead of to a fixed shape.
  const base = { speed: 1, pitchSemitones: 0, dopplerEnabled: true, dopplerIntensitySemitones: 6 }
  const forward = await renderLoopClip({ id: 'dop', inputPath: source, loopStart: 0, loopEnd: 6, crossfadeSeconds: 0.1, speedPitch: base, filters: {} })
  const backward = await renderLoopClip({ id: 'dopr', inputPath: source, loopStart: 0, loopEnd: 6, crossfadeSeconds: 0.1, speedPitch: { ...base, reversed: true }, filters: {} })
  assert.equal(forward.ok, true, forward.error)
  assert.equal(backward.ok, true, backward.error)
  const slope = (name) => {
    const clip = decodeMono(path.join(dir, 'clips', name + '.wav'))
    return freqOf(clip, 5, 5.7) - freqOf(clip, 0.3, 1)
  }
  assert.ok(slope('dop') * slope('dopr') < 0, 'reverse flips the bend: ' + slope('dop') + ' vs ' + slope('dopr'))
})

test('renderLoopClip saves Noise reduction: hiss goes down, the tone stays', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, async () => {
  const { renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js')
  const noisy = path.join(dir, 'noisy.wav')
  // Quiet hiss for the whole 8 s, a 1 kHz tone from 4 s on.
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anoisesrc=d=8:c=white:a=0.05:r=${RATE}:seed=3`, '-f', 'lavfi', '-i', `sine=f=1000:d=4:r=${RATE}`, '-filter_complex', '[1]adelay=4000|4000[t];[0][t]amix=inputs=2:normalize=0', '-c:a', 'pcm_s16le', noisy])
  const base = { id: 'noise-off', inputPath: noisy, loopStart: 0, loopEnd: 8, crossfadeSeconds: 0.1, speedPitch: null }
  const off = await renderLoopClip({ ...base, filters: {} })
  const on = await renderLoopClip({ ...base, id: 'noise-on', filters: { denoiseEnabled: true, denoiseStrengthDb: 18, denoiseSampleStartSec: 0, denoiseSampleEndSec: 3 } })
  assert.equal(off.ok && on.ok, true)
  const a = decodeMono(path.join(dir, 'clips', 'noise-off.wav'))
  const b = decodeMono(path.join(dir, 'clips', 'noise-on.wav'))
  const rms = (x, t0, t1) => Math.sqrt(x.slice(Math.round(t0 * RATE), Math.round(t1 * RATE)).reduce((s, v) => s + v * v, 0) / ((t1 - t0) * RATE))
  // The crossfade rotates the loop, so look at whole halves: the hiss-only half is quieter, and so is the whole.
  assert.ok(rms(b, 0, 7.5) < rms(a, 0, 7.5), 'denoised clip is quieter overall')
  const tone = (x) => {
    let c = 0
    let s = 0
    for (let i = 0; i < x.length; i++) {
      c += x[i] * Math.cos((2 * Math.PI * 1000 * i) / RATE)
      s += x[i] * Math.sin((2 * Math.PI * 1000 * i) / RATE)
    }
    return (2 * Math.hypot(c, s)) / x.length
  }
  assert.ok(Math.abs(20 * Math.log10(tone(b) / tone(a))) < 1.5, 'tone level kept')
})
