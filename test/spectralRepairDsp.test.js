import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repairChannels, SpectralRepairChannel, LATENCY } from '../src/shared/spectralRepairDsp.js'

const SR = 44100
function tone(freq, seconds, amp = 0.5) {
  const a = new Float32Array(Math.round(SR * seconds))
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return a
}
function rms(x, from, to) {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / (to - from))
}
const db = (r) => 20 * Math.log10(r)

test('no boxes: output equals input', () => {
  const x = tone(1000, 1)
  const [y] = repairChannels([x], SR, [])
  let worst = 0
  for (let i = 0; i < x.length; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]))
  assert.ok(worst < 1e-4, `worst ${worst}`)
})

test('a box turns its tone down about 40 dB and leaves another tone alone', () => {
  const a = tone(3000, 3)
  const b = tone(500, 3)
  const mix = new Float32Array(a.length)
  for (let i = 0; i < mix.length; i++) mix[i] = a[i] + b[i]
  const [y] = repairChannels([mix], SR, [{ startSec: 1, endSec: 2, lowHz: 2500, highHz: 3500, reductionDb: 40 }])
  // inside the box (away from the fade edges), only the 500 Hz tone is left
  const inside = rms(y, Math.round(SR * 1.4), Math.round(SR * 1.6))
  assert.ok(Math.abs(db(inside) - db(rms(b, 0, 4000))) < 0.5, `inside ${db(inside)}`)
  // outside the box in time the mix is untouched
  const outside = rms(y, Math.round(SR * 2.6), Math.round(SR * 2.8))
  const expected = rms(mix, Math.round(SR * 2.6), Math.round(SR * 2.8))
  assert.ok(Math.abs(db(outside) - db(expected)) < 0.1)
})

test('edges fade over about one frame and the box is not shifted in time', () => {
  const x = tone(3000, 3)
  const [y] = repairChannels([x], SR, [{ startSec: 1, endSec: 2, lowHz: 2500, highHz: 3500, reductionDb: 60 }])
  const level = (t) => rms(y, Math.round(SR * t) - 400, Math.round(SR * t) + 400)
  assert.ok(level(0.8) > 0.3, 'before the box is intact')
  assert.ok(level(1.5) < 0.01, 'inside is gone')
  assert.ok(level(2.2) > 0.3, 'after the box is intact')
})

test('streaming in small blocks gives the same result as one go', () => {
  const x = tone(3000, 1)
  const regions = [{ startSec: 0.3, endSec: 0.6, lowHz: 2500, highHz: 3500, reductionDb: 40 }]
  const [whole] = repairChannels([x], SR, regions)
  const ch = new SpectralRepairChannel(SR, (i) => i / SR)
  ch.setRegions(regions)
  const out = new Float32Array(x.length)
  const inBuf = new Float32Array(128)
  const outBuf = new Float32Array(128)
  const total = x.length + LATENCY + 1024
  for (let i = 0; i < total; i += 128) {
    for (let k = 0; k < 128; k++) inBuf[k] = i + k < x.length ? x[i + k] : 0
    ch.process(inBuf, outBuf, 128)
    for (let k = 0; k < 128; k++) {
      const o = i + k - LATENCY
      if (o >= 0 && o < x.length) out[o] = outBuf[k]
    }
  }
  for (let i = 0; i < x.length; i += 97) assert.ok(Math.abs(out[i] - whole[i]) < 1e-5)
})
