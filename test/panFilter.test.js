import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { stereoPanMatrix as pluginPanMatrix } from '../plugins/editor/audio/PanStage.js'
import { buildPanFilter, normalizePan, parseChannelCount, stereoPanMatrix } from '../src/main/ffmpeg/panFilter.js'

const close = (a, b) => Math.abs(a - b) < 1e-9

describe('stereoPanMatrix', () => {
  test('center is exactly the identity', () => {
    assert.deepEqual(stereoPanMatrix(0).flat().map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 0, 1])
  })

  test('hard left puts everything in the left speaker', () => {
    const [[ll, lr], [rl, rr]] = stereoPanMatrix(-1)
    assert.ok(close(ll, Math.SQRT1_2) && close(lr, Math.SQRT1_2) && close(rl, 0) && close(rr, 0))
  })

  test('hard right mirrors hard left', () => {
    const [[ll, lr], [rl, rr]] = stereoPanMatrix(1)
    assert.ok(close(ll, 0) && close(lr, 0) && close(rl, Math.SQRT1_2) && close(rr, Math.SQRT1_2))
  })

  test('a mono sound peaks at +3 dB in one speaker at a hard pan, never more', () => {
    for (let p = -1; p <= 1; p += 0.05) {
      const [[ll, lr], [rl, rr]] = stereoPanMatrix(p)
      assert.ok(ll + lr <= Math.SQRT2 + 1e-9 && rl + rr <= Math.SQRT2 + 1e-9)
    }
    const [[ll, lr]] = stereoPanMatrix(-1)
    assert.ok(close(ll + lr, Math.SQRT2))
  })

  test('the pan law is continuous through center', () => {
    const a = stereoPanMatrix(-1e-9).flat()
    const b = stereoPanMatrix(1e-9).flat()
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6))
  })

  test('wide (uncorrelated) stereo keeps its loudness on the near side while panning', () => {
    for (const p of [-1, -0.6, -0.2]) {
      const [[ll, lr]] = stereoPanMatrix(p)
      assert.ok(close(ll * ll + lr * lr, 1))
    }
  })
})

describe('pan law strength (v0.1.227)', () => {
  // Power ratio near/far for uncorrelated stereo, and amplitude ratio for mono, in dB.
  const wideDb = (p) => {
    const [[ll, lr], [rl, rr]] = stereoPanMatrix(-p)
    return 10 * Math.log10((ll * ll + lr * lr) / (rl * rl + rr * rr))
  }
  const monoDb = (p) => {
    const [[ll, lr], [rl, rr]] = stereoPanMatrix(-p)
    return 20 * Math.log10((ll + lr) / (rl + rr))
  }

  test('wide stereo audibly moves at moderate pans', () => {
    assert.ok(wideDb(0.25) > 1.8 && wideDb(0.25) < 2.5)
    assert.ok(wideDb(0.5) > 5 && wideDb(0.5) < 5.7)
    assert.ok(wideDb(0.75) > 10.5 && wideDb(0.75) < 12)
  })

  test('mono stays close to a standard mixer pan', () => {
    assert.ok(monoDb(0.25) > 3 && monoDb(0.25) < 6)
    assert.ok(monoDb(0.5) > 7 && monoDb(0.5) < 9.5)
    assert.ok(monoDb(0.75) > 13 && monoDb(0.75) < 16.5)
  })

  test('balance grows steadily from center to the side', () => {
    let prev = -1
    for (let p = 0; p < 1; p += 0.05) {
      const db = wideDb(p)
      assert.ok(db > prev)
      prev = db
    }
  })

  test('the Remix plugin copy matches core exactly', () => {
    for (let p = -1; p <= 1; p += 0.01) assert.deepEqual(pluginPanMatrix(p), stereoPanMatrix(p))
  })
})

describe('buildPanFilter', () => {
  test('centered (or invalid) pan builds nothing, so unpanned renders are unchanged', () => {
    assert.equal(buildPanFilter(0, 2), null)
    assert.equal(buildPanFilter(undefined, 1), null)
    assert.equal(buildPanFilter('nope', 2), null)
  })

  test('mono input only references c0', () => {
    const f = buildPanFilter(-0.3, 1)
    assert.ok(f.startsWith('pan=stereo|'))
    assert.ok(!f.includes('c1*') && !f.includes('*c1'))
  })

  test('stereo input is forced to a stereo layout first', () => {
    assert.ok(buildPanFilter(0.4, 2).startsWith('aformat=channel_layouts=stereo,pan=stereo|'))
    assert.ok(buildPanFilter(0.4, 6).startsWith('aformat=channel_layouts=stereo,pan=stereo|'))
  })

  test('out-of-range pan clamps to hard left/right', () => {
    assert.equal(buildPanFilter(5, 2), buildPanFilter(1, 2))
    assert.equal(normalizePan(-3), -1)
  })
})

describe('parseChannelCount', () => {
  test('reads mono, stereo, 5.1 and "N channels" layouts', () => {
    const line = (layout) => `  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, ${layout}, s16, 705 kb/s`
    assert.equal(parseChannelCount(line('mono')), 1)
    assert.equal(parseChannelCount(line('stereo')), 2)
    assert.equal(parseChannelCount(line('5.1(side)')), 2)
    assert.equal(parseChannelCount(line('3 channels')), 3)
    assert.equal(parseChannelCount('no stream info'), null)
  })
})
