// End-to-end: a FREEHAND Spectral repair shape (drawn with the lasso) is one engine live and saved.
// Copy of the Spectral test in repair.e2e.mjs with the box drawn as a freehand loop. Original header follows.
// End-to-end: one engine for Spectral repair and Noise reduction. Same shape as
// pitch.e2e.mjs: tee the app output into an analyser, measure the auto-saved
// clip with ffmpeg, and check the live preview and the saved clip agree.
//   Spectral: 440 Hz + 1500 Hz, a box over 1500 Hz -> that tone drops 20+ dB
//             live and saved, the 440 Hz tone stays put.
//   Noise:    440 Hz tone + white noise (noise alone for the first 2.5 s),
//             sample the noise-only stretch -> the noise floor drops by about
//             the same dB live and saved, the tone stays within 1.5 dB.
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { launchApp } from './launch.mjs'

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
const RATE = 44100
const SECONDS = 20
const FFT = 32768
const NOISE_ONLY_SEC = 2.5
let app
let page
const files = []
const sources = {} // sound name -> Float32Array of what was written to disk

function writeWav(file, samples) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

function seededNoise(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

function makeSound(name, fn) {
  const samples = new Float32Array(RATE * SECONDS)
  for (let i = 0; i < samples.length; i++) samples[i] = fn(i / RATE)
  const file = path.join(os.tmpdir(), `noctivago-e2e-repair-${process.pid}-${name.replace(/\W/g, '')}.wav`)
  writeWav(file, samples)
  files.push(file)
  sources[name] = samples
  return file
}

// Hann-windowed Goertzel power at one frequency.
function powerAt(samples, sr, hz) {
  const n = Math.min(samples.length, FFT)
  const c = 2 * Math.cos((2 * Math.PI * hz) / sr)
  let s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    const s0 = samples[i] * w + c * s1 - s2
    s2 = s1; s1 = s0
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2
}
const toneDb = (samples, sr, hz) => 10 * Math.log10(powerAt(samples, sr, hz) || 1e-30)
// Average power over 2-8 kHz in 50 Hz steps: where the white noise lives, nothing else does.
function floorDb(samples, sr) {
  let sum = 0, count = 0
  for (let hz = 2000; hz <= 8000; hz += 50) { sum += powerAt(samples, sr, hz); count++ }
  return 10 * Math.log10(sum / count || 1e-30)
}

// What the app is playing right now, from the analyser tee set up below.
async function listen() {
  const taps = await page.evaluate(() => (window.__taps || []).map((a) => {
    const d = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(d)
    return { sr: a.context.sampleRate, data: Array.from(d) }
  }))
  const loud = taps.map((t) => ({ sr: t.sr, samples: Float32Array.from(t.data) })).filter((t) => {
    let sum = 0
    for (const s of t.samples) sum += s * s
    return 10 * Math.log10(sum / t.samples.length || 1e-30) > -60
  })
  assert.equal(loud.length, 1, `one audio context playing, got ${loud.length}`)
  return loud[0]
}

async function playFor(ms) {
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(ms)
  const heard = await listen()
  await page.locator('#editor-play-pause').click()
  return heard
}

async function pickSound(name) {
  await page.locator('.tab-panel:not(.hidden)').getByText(name).first().click()
  await page.waitForTimeout(2500)
}

// The auto-saved clip written after `since`, one second from 3 s in (past the noise-only stretch).
async function savedClip(since) {
  if (!(await page.locator('#editor-save').isDisabled())) await page.locator('#editor-save').click()
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#editor-save-status')?.textContent ?? ''), null, { timeout: 20000 })
  const profileDir = path.join(process.env.APPDATA, `noctivago-e2e-${process.pid}`)
  const clips = fs.readdirSync(profileDir, { recursive: true }).map((f) => path.join(profileDir, f)).filter((f) => /\.wav$/i.test(f) && fs.statSync(f).mtimeMs > since)
  assert.ok(clips.length >= 1, `a fresh clip under ${profileDir}`)
  clips.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', '3', '-t', '1', '-i', clips[0], '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'])
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice(0, FFT)
}

before(async () => {
  const noise = seededNoise(12345)
  const spectralFile = makeSound('Spectral two tones', (t) => 0.2 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 1500 * t))
  const noiseFile = makeSound('Noise tone', (t) => 0.1 * noise() + (t >= NOISE_ONLY_SEC ? 0.2 * Math.sin(2 * Math.PI * 440 * t) : 0))
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  // Tee everything that reaches a speaker into one analyser per audio context.
  await page.context().addInitScript(() => {
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const ctx = target.context
        if (!ctx.__tap) {
          ctx.__tap = ctx.createAnalyser()
          ctx.__tap.fftSize = 32768
          ;(window.__taps ||= []).push(ctx.__tap)
        }
        connect.call(this, ctx.__tap)
      }
      return connect.call(this, target, ...rest)
    }
  })
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Spectral two tones', keepCopy: true }), spectralFile)
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Noise tone', keepCopy: true }), noiseFile)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

test('Freehand spectral repair: a loop over the second tone takes it 20+ dB down, live and saved, the first tone stays', async (t) => {
  await pickSound('Spectral two tones')
  const src = sources['Spectral two tones']
  const srcA = toneDb(src.slice(3 * RATE, 3 * RATE + FFT), RATE, 440)
  const srcB = toneDb(src.slice(3 * RATE, 3 * RATE + FFT), RATE, 1500)

  const before = await playFor(3000)
  const liveA0 = toneDb(before.samples, before.sr, 440)
  const liveB0 = toneDb(before.samples, before.sr, 1500)
  assert.ok(Math.abs(liveA0 - liveB0) <= 1.5, `both tones start level, got ${liveA0.toFixed(1)} / ${liveB0.toFixed(1)} dB`)

  // Drag a box across the whole trim, 1.2-1.9 kHz (the canvas is log-Hz, 30 Hz at the bottom to 20 kHz).
  const canvas = page.locator('#editor-spectral-canvas')
  await page.locator('#editor-mode-panel-sound [data-rx-view="spec"]').click()
  await page.waitForTimeout(1500)
  // Sharp spectrogram: two pure tones are two thin lines. A blurry 16-row image stretched over the canvas makes them 28+ px thick each.
  const bright = await canvas.evaluate((c) => {
    const d = c.getContext('2d').getImageData(Math.floor(c.width * 0.7), 0, 1, c.height).data
    let n = 0
    for (let i = 0; i < c.height; i++) if (d[i * 4] > 200) n++
    return { n, height: c.height }
  })
  assert.ok(bright.n <= 30, `spectrogram looks blurry: ${bright.n} of ${bright.height} rows are bright for two thin tones`)
  await canvas.scrollIntoViewIfNeeded()
  let box = await canvas.boundingBox()
  const yFor = (hz) => box.y + box.height * (1 - Math.log(hz / 30) / Math.log(20000 / 30))
  const since = Date.now()
  await page.locator('#editor-spectral-shape [data-shape="free"]').click()
  await page.waitForTimeout(300)
  box = await canvas.boundingBox() // the toggle can shift the layout
  const x0 = box.x + 3, x1 = box.x + box.width - 3
  await page.mouse.move(x0, yFor(1900))
  await page.mouse.down()
  await page.mouse.move(x1, yFor(1900), { steps: 10 })
  await page.mouse.move(x1, yFor(1200), { steps: 6 })
  await page.mouse.move(x0, yFor(1200), { steps: 10 })
  await page.mouse.move(x0 + 2, yFor(1850), { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(() => /\d+ box|–/.test(document.querySelector('#editor-spectral-selection')?.textContent ?? ''))

  const after = await playFor(3500)
  const liveA = toneDb(after.samples, after.sr, 440) - liveA0
  const liveB = toneDb(after.samples, after.sr, 1500) - liveB0
  assert.ok(liveB <= -20, `live 1500 Hz tone moved ${liveB.toFixed(1)} dB, want 20+ down`)
  assert.ok(Math.abs(liveA) <= 1.5, `live 440 Hz tone moved ${liveA.toFixed(1)} dB`)

  const saved = await savedClip(since)
  const savedA = toneDb(saved, RATE, 440) - srcA
  const savedB = toneDb(saved, RATE, 1500) - srcB
  assert.ok(savedB <= -20, `saved 1500 Hz tone moved ${savedB.toFixed(1)} dB, want 20+ down`)
  assert.ok(Math.abs(savedA) <= 1.5, `saved 440 Hz tone moved ${savedA.toFixed(1)} dB`)
  t.diagnostic(`1500 Hz: live ${liveB.toFixed(1)} dB, saved ${savedB.toFixed(1)} dB; 440 Hz: live ${liveA.toFixed(1)} dB, saved ${savedA.toFixed(1)} dB`)
})
