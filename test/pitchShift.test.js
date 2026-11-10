import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stretchChannels } from '../src/main/ffmpeg/pitchShift.js'

const SR = 44100
function sine(freq, seconds) {
  const a = new Float32Array(Math.round(SR * seconds))
  for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / SR)
  return a
}
function freqOf(x, from, to) {
  let z = 0
  for (let i = from; i < to - 1; i++) if (x[i] <= 0 && x[i + 1] > 0) z++
  return z / ((to - from) / SR)
}

test('+12 semitones doubles the frequency and keeps the length', async () => {
  const [out] = await stretchChannels([sine(440, 2)], SR, { semitonesAt: () => 12 })
  assert.equal(out.length, SR * 2)
  assert.ok(Math.abs(freqOf(out, SR / 2, SR * 1.5) - 880) < 10)
})

test('tempo 2 halves the length and keeps the pitch', async () => {
  const [out] = await stretchChannels([sine(440, 2)], SR, { rate: 2 })
  assert.equal(out.length, SR)
  assert.ok(Math.abs(freqOf(out, SR / 4, SR * 0.75) - 440) < 10)
})

test('a click lands where it started (no engine delay left in the output)', async () => {
  const x = new Float32Array(SR * 2)
  for (let i = -20; i <= 20; i++) x[SR + i] = Math.exp(-Math.abs(i) / 4)
  const [out] = await stretchChannels([x], SR, {})
  let peak = 0
  let at = 0
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i]) > peak) {
      peak = Math.abs(out[i])
      at = i
    }
  }
  assert.ok(Math.abs(at - SR) < 200, `peak at ${at}, expected near ${SR}`)
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dopplerSemitones } from '../src/shared/doppler.js'
import { pitchShiftWavFile, readWav, writeWavFloat, needsPitchPass } from '../src/main/ffmpeg/pitchShift.js'

test('Doppler contour: marker is natural pitch, Start/End are +/- intensity', () => {
  const d = 10
  assert.ok(Math.abs(dopplerSemitones(5, d, 0.5, 6)) < 1e-9)
  assert.ok(Math.abs(dopplerSemitones(0, d, 0.5, 6) - 6) < 1e-9)
  assert.ok(Math.abs(dopplerSemitones(d, d, 0.5, 6) + 6) < 1e-9)
  // reversed: natural at both ends
  assert.ok(Math.abs(dopplerSemitones(0, d, 0.5, 6, true)) < 1e-9)
  assert.ok(Math.abs(dopplerSemitones(d, d, 0.5, 6, true)) < 1e-9)
})

test('needsPitchPass is false for neutral settings', () => {
  assert.equal(needsPitchPass(null), false)
  assert.equal(needsPitchPass({ speed: 1, pitchSemitones: 0, reversed: true }), false)
  assert.equal(needsPitchPass({ speed: 1.2 }), true)
  assert.equal(needsPitchPass({ dopplerEnabled: true }), true)
})

test('a stereo WAV file goes through the pitch pass with Speed, Pitch and Doppler', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitchpass-'))
  const a = path.join(dir, 'in.wav')
  const b = path.join(dir, 'out.wav')
  writeWavFloat(a, [sine(440, 3), sine(550, 3)], SR)
  await pitchShiftWavFile(a, b, { speed: 1.5, pitchSemitones: 3, dopplerEnabled: true, dopplerIntensitySemitones: 5 })
  const out = readWav(b)
  assert.equal(out.channels.length, 2)
  assert.equal(out.channels[0].length, Math.round((SR * 3) / 1.5))
  const peak = out.channels[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  assert.ok(peak > 0.5 && peak < 1.5, `peak ${peak}`)
  fs.rmSync(dir, { recursive: true, force: true })
})
