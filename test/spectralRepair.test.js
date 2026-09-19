import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSpectralRepairFilter, normalizeSpectralRepair } from '../src/main/ffmpeg/spectralRepair.js'

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

// Level of one frequency in [t0, t1) seconds of `samples`, in dB (Goertzel).
function toneDb(samples, freq, t0, t1) {
  const a = Math.round(t0 * RATE)
  const b = Math.round(t1 * RATE)
  const k = 2 * Math.cos((2 * Math.PI * freq) / RATE)
  let s1 = 0
  let s2 = 0
  for (let i = a; i < b; i++) {
    const s0 = samples[i] + k * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - k * s1 * s2
  return 10 * Math.log10(power / ((b - a) * (b - a)) + 1e-20)
}

describe('normalizeSpectralRepair', () => {
  test('orders and clamps bounds', () => {
    assert.deepEqual(normalizeSpectralRepair({ startSec: 3, endSec: 1, lowHz: 9000, highHz: 5, reductionDb: 200 }), {
      startSec: 1,
      endSec: 3,
      lowHz: 20,
      highHz: 9000,
      reductionDb: 80
    })
  })
  test('drops empty or inert regions', () => {
    assert.equal(normalizeSpectralRepair({ startSec: 1, endSec: 1, lowHz: 100, highHz: 200 }), null)
    assert.equal(normalizeSpectralRepair({ startSec: 1, endSec: 2, lowHz: 100, highHz: 100 }), null)
    assert.equal(normalizeSpectralRepair({ startSec: 1, endSec: 2, lowHz: 100, highHz: 200, reductionDb: 0 }), null)
    assert.equal(normalizeSpectralRepair({ startSec: 'x', endSec: 2, lowHz: 100, highHz: 200 }), null)
  })
})

describe('buildSpectralRepairFilter', () => {
  test('null when nothing applies', () => {
    assert.equal(buildSpectralRepairFilter(undefined, 0, 10), null)
    assert.equal(buildSpectralRepairFilter([], 0, 10), null)
    // Entirely outside the loop.
    assert.equal(buildSpectralRepairFilter([{ startSec: 12, endSec: 13, lowHz: 100, highHz: 200 }], 0, 10), null)
  })
  test('shifts region times by loopStart and clips them to the loop', () => {
    const f = buildSpectralRepairFilter([{ startSec: 1, endSec: 4, lowHz: 100, highHz: 200, reductionDb: 20 }], 2, 10)
    assert.match(f, /between\(pts\/sr,0,2\)/)
    assert.match(f, /between\(b\*sr\/\(2\*nb\),100,200\)\*0\.9\)/)
  })
})

describe('spectral repair on the real ffmpeg', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, () => {
  let dir
  let source

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-spectral-'))
    process.env.NOCTIVAGO_TEST_USERDATA = dir
    source = path.join(dir, 'tones.wav')
    execFileSync(ffmpeg, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `sine=f=500:d=8:r=${RATE}`,
      '-f', 'lavfi', '-i', `sine=f=3000:d=8:r=${RATE}`,
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0', '-c:a', 'pcm_f32le', source
    ])
  })

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  // Mirrors doRender's pre-processing read: -ss loopStart before -i, so the
  // filter sees t=0 at loopStart.
  test('cuts only inside the box, on the loop-relative timeline', () => {
    const loopStart = 2
    const af = buildSpectralRepairFilter([{ startSec: 4, endSec: 5, lowHz: 2000, highHz: 4000, reductionDb: 60 }], loopStart, 8)
    const out = path.join(dir, 'cut.wav')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(loopStart), '-t', '6', '-i', source, '-af', af, '-c:a', 'pcm_f32le', out])
    const dry = decodeMono(source)
    const wet = decodeMono(out)
    assert.ok(Math.abs(wet.length / RATE - 6) < 0.01, `length ${wet.length / RATE}`)
    // Source 4.1-4.9s is output 2.1-2.9s: 3kHz gone, 500Hz untouched.
    assert.ok(toneDb(wet, 3000, 2.1, 2.9) < toneDb(dry, 3000, 4.1, 4.9) - 30)
    assert.ok(Math.abs(toneDb(wet, 500, 2.1, 2.9) - toneDb(dry, 500, 4.1, 4.9)) < 0.2)
    // Outside the box in time: 3kHz untouched.
    assert.ok(Math.abs(toneDb(wet, 3000, 0.5, 1.5) - toneDb(dry, 3000, 2.5, 3.5)) < 0.2)
    assert.ok(Math.abs(toneDb(wet, 3000, 3.5, 4.5) - toneDb(dry, 3000, 5.5, 6.5)) < 0.2)
  })

  test('renderLoopClip bakes it (forces the pre-processing pass)', async () => {
    const { renderLoopClip } = await import('../src/main/ffmpeg/loopClip.js')
    const result = await renderLoopClip({
      id: 'spectral',
      inputPath: source,
      loopStart: 0,
      loopEnd: 8,
      crossfadeSeconds: 0.1,
      speedPitch: null,
      // The whole loop, so the crossfade rotation doesn't matter.
      filters: { spectralRepairs: [{ startSec: 0, endSec: 8, lowHz: 2000, highHz: 4000, reductionDb: 60 }] }
    })
    assert.equal(result.ok, true, result.error)
    const clip = decodeMono(path.join(dir, 'clips', 'spectral.wav'))
    const dry = decodeMono(source)
    assert.ok(toneDb(clip, 3000, 2, 5) < toneDb(dry, 3000, 2, 5) - 30)
    assert.ok(Math.abs(toneDb(clip, 500, 2, 5) - toneDb(dry, 500, 2, 5)) < 0.5)
  })

  test('spectrogram puts a tone in the right row and time', async () => {
    const { extractSpectrogram, spectrogramRowEdges } = await import('../src/main/ffmpeg/spectrogram.js')
    const gated = path.join(dir, 'gated.wav')
    // 3kHz only during 2-4s of a 6s file.
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=sin(2*PI*3000*t)*between(t\\,2\\,4):s=${RATE}:d=6`, '-c:a', 'pcm_f32le', gated])
    const columns = 60
    const rows = 64
    const spec = await extractSpectrogram({ inputPath: gated, windowStart: 0, windowEnd: 6, columns, rows })
    assert.equal(spec.values.length, columns * rows)
    const edges = spectrogramRowEdges(rows)
    const toneRow = edges.findIndex((e, r) => e <= 3000 && edges[r + 1] > 3000)
    const at = (c, r) => spec.values[c * rows + r]
    // Column 30 = 3.0-3.1s: brightest row is the 3kHz one.
    let best = 0
    for (let r = 1; r < rows; r++) if (at(30, r) > at(30, best)) best = r
    assert.equal(best, toneRow)
    assert.equal(at(30, toneRow), 255)
    // Column 5 = 0.5s: silence.
    assert.ok(at(5, toneRow) < 30, `silent column ${at(5, toneRow)}`)
  })
})
