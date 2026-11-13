// End-to-end: one engine for pitch. A 440 Hz tone in Remix with Pitch moved:
// the live preview (Signalsmith Stretch worklet) and the auto-saved clip must
// land on the same note at the same level. Needs the Remix build in
// ../noctivago-plugin-repos/noctivago-remix.
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
let app
let page
let wavPath

function writeTone(file) {
  const n = RATE * 20
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.3 * 32767), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

// Strongest frequency (Goertzel scan, 1 Hz steps, 150-1500 Hz) and RMS in dB.
function analyse(samples, sr) {
  let best = 0, peakHz = 0, sum = 0
  for (const s of samples) sum += s * s
  for (let f = 150; f <= 1500; f++) {
    const c = 2 * Math.cos((2 * Math.PI * f) / sr)
    let s1 = 0, s2 = 0
    for (let i = 0; i < samples.length; i++) { const s0 = samples[i] + c * s1 - s2; s2 = s1; s1 = s0 }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2
    if (p > best) { best = p; peakHz = f }
  }
  return { peakHz, rmsDb: 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-9) }
}

// What the app is playing right now, from the analyser tee set up below.
async function listen() {
  const taps = await page.evaluate(() => (window.__taps || []).map((a) => {
    const d = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(d)
    return { sr: a.context.sampleRate, data: Array.from(d) }
  }))
  const loud = taps.map((t) => analyse(Float32Array.from(t.data), t.sr)).filter((r) => r.rmsDb > -60)
  assert.equal(loud.length, 1, `one audio context playing, got ${JSON.stringify(loud)}`)
  return loud[0]
}

async function playFor(ms) {
  await page.locator('#editor-play-pause').click()
  await page.waitForTimeout(ms)
  const heard = await listen()
  await page.locator('#editor-play-pause').click()
  return heard
}

before(async () => {
  wavPath = path.join(os.tmpdir(), `noctivago-e2e-pitch-${process.pid}.wav`)
  writeTone(wavPath)
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
  await page.evaluate((p) => window.noctivago.library.addSound({ path: p, name: 'Pitch tone', keepCopy: true }), wavPath)
  await page.reload()
  await page.waitForSelector('.mx-item')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.tab-panel:not(.hidden)').getByText('Pitch tone').first().click()
  await page.waitForTimeout(2500)
})

after(async () => {
  await app?.close()
  if (wavPath) fs.rmSync(wavPath, { force: true })
})

test('Pitch +7: live preview and saved clip play the same note at the same level', async () => {
  const flat = await playFor(2500)
  assert.ok(Math.abs(flat.peakHz - 440) <= 2, `unshifted preview at ${flat.peakHz} Hz`)

  const since = Date.now()
  await page.evaluate(() => {
    const el = document.querySelector('#editor-pitch')
    el.value = '7'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const expected = 440 * 2 ** (7 / 12) // 659.3 Hz
  const live = await playFor(3000)
  assert.ok(Math.abs(live.peakHz - expected) <= 3, `live preview at ${live.peakHz} Hz, want ${expected.toFixed(1)}`)
  assert.ok(Math.abs(live.rmsDb - flat.rmsDb) <= 1, `live level moved ${(live.rmsDb - flat.rmsDb).toFixed(1)} dB`)

  // Autosave bakes the clip a moment after the edit; Save covers a slow one.
  if (!(await page.locator('#editor-save').isDisabled())) await page.locator('#editor-save').click()
  await page.waitForFunction(() => /saved/i.test(document.querySelector('#editor-save-status')?.textContent ?? ''), null, { timeout: 20000 })
  const profileDir = path.join(process.env.APPDATA, `noctivago-e2e-${process.pid}`)
  const clips = fs.readdirSync(profileDir, { recursive: true }).map((f) => path.join(profileDir, f)).filter((f) => /\.wav$/i.test(f) && fs.statSync(f).mtimeMs > since)
  assert.equal(clips.length, 1, `one fresh clip under ${profileDir}: ${clips.join(', ')}`)
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-ss', '2', '-t', '1', '-i', clips[0], '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'])
  const saved = analyse(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice(0, 32768), RATE)
  assert.ok(Math.abs(saved.peakHz - expected) <= 3, `saved clip at ${saved.peakHz} Hz, want ${expected.toFixed(1)}`)
  // The preview path sits a few dB under the file (preview volume); compare the change each side made.
  const sourceDb = 20 * Math.log10(0.3 / Math.SQRT2)
  assert.ok(Math.abs(saved.rmsDb - sourceDb - (live.rmsDb - flat.rmsDb)) <= 1, `saved level ${saved.rmsDb.toFixed(1)} dB vs source ${sourceDb.toFixed(1)} dB`)
})
