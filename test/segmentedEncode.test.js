import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ffmpegPath.js reaches electron; same stub as runFfmpegChain.test.js.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
      if (spec === 'electron') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const app = { isPackaged: false }') }
      }
      return next(spec, ctx)
    }`)
)

const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const needsFfmpeg = { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }

let mod
let dir
before(async () => {
  mod = await import('../src/main/ffmpeg/segmentedEncode.js')
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'segenc-'))
})
after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('windows tile the export on Opus frame boundaries, a multiple of the encoder count', () => {
  const total = 9 * 3600 * 48000
  const windows = mod.planWindows(total, 11)
  assert.equal(windows.length % 11, 0)
  assert.equal(windows[0].start, 0)
  assert.equal(windows.at(-1).end, total)
  windows.forEach((w, i) => {
    assert.equal(w.start % 960, 0)
    assert.ok(w.end - w.start <= 300 * 48000)
    if (i > 0) assert.equal(w.start, windows[i - 1].end)
    assert.equal(w.padStart, Math.max(0, w.start - 48000))
    assert.equal(w.padEnd, Math.min(total, w.end + 48000))
  })
})

test('a short export is one window; windows never go under a minute when avoidable', () => {
  assert.equal(mod.planWindows(30 * 48000, 8).length, 1)
  assert.equal(mod.planWindows(150 * 48000, 8).length, 2)
})

describe('mixToOpusInParallel', needsFfmpeg, () => {
  test('stitched windows decode to the exact length, with no seam glitch', async () => {
    const seconds = 150
    const out = path.join(dir, 'out.opus')
    let n = 0
    await mod.mixToOpusInParallel({
      // Each window renders its own stretch of one continuous tone.
      mixArgsFor: (win) => [
        '-y', '-f', 'lavfi',
        '-i', `aevalsrc=0.5*sin(2*PI*440*(t+${win.padStart / 48000}))|0.5*sin(2*PI*660*(t+${win.padStart / 48000})):s=48000:d=${(win.padEnd - win.padStart) / 48000}`,
        '-t', String((win.padEnd - win.padStart) / 48000)
      ],
      codecArgs: ['-c:a', 'libopus', '-b:a', '128k'],
      durationSeconds: seconds,
      outputPath: out,
      concurrency: 2,
      tempPath: (ext) => path.join(dir, `t${n++}.${ext}`)
    })
    const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', out, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-'], { maxBuffer: 1 << 30 }).stdout
    const pcm = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.length / 4)
    assert.equal(pcm.length / 2, seconds * 48000)
    // Error against the ideal tone, around the seam (75 s) vs. elsewhere.
    const rmsError = (fromS, toS) => {
      let sum = 0
      let count = 0
      for (let i = Math.round(fromS * 48000); i < Math.round(toS * 48000); i++) {
        const t = i / 48000
        sum += (pcm[2 * i] - 0.5 * Math.sin(2 * Math.PI * 440 * t)) ** 2
        count++
      }
      return Math.sqrt(sum / count)
    }
    const seam = rmsError(74.9, 75.1)
    const elsewhere = rmsError(30, 31)
    assert.ok(seam < elsewhere * 3 + 1e-3, `seam error ${seam} vs ${elsewhere}`)
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('t')), [])
  })
})
