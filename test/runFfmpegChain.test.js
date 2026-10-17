import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ffmpegPath.js reaches electron; same stub idea as storedAudio.test.js so
// the real bundled ffmpeg runs under node --test.
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

const PRODUCER = ['-y', '-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=44100', '-c:a', 'pcm_f32le', '-ac', '2', '-f', 'nut', 'pipe:1']

let dir
let runFfmpegChain

describe('runFfmpegChain', needsFfmpeg, () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffchain-'))
    ;({ runFfmpegChain } = await import('../src/main/ffmpeg/runFfmpeg.js'))
  })
  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('pipes the mix into the encoder', async () => {
    const out = path.join(dir, 'ok.opus')
    let progressed = false
    await runFfmpegChain(PRODUCER, ['-y', '-f', 'nut', '-i', 'pipe:0', '-c:a', 'libopus', '-ar', '48000', out], {
      onProgress: () => (progressed = true)
    })
    assert.ok(fs.statSync(out).size > 1000)
    assert.ok(progressed)
  })

  test('rejects when the encoder fails', async () => {
    // libopus refuses 44100 Hz
    await assert.rejects(runFfmpegChain(PRODUCER, ['-y', '-f', 'nut', '-i', 'pipe:0', '-c:a', 'libopus', '-ar', '44100', path.join(dir, 'bad.opus')]))
  })

  test('rejects when the mix fails', async () => {
    await assert.rejects(
      runFfmpegChain(['-y', '-i', path.join(dir, 'missing.wav'), '-f', 'nut', 'pipe:1'], ['-y', '-f', 'nut', '-i', 'pipe:0', path.join(dir, 'x.opus')])
    )
  })
})
