// End-to-end: in Remix Group mode, a member row's Play and the group row's Play sound through the group's own
// settings (owner, 2026-11-17: Thunda members played without the group's EQ). Three groups hold one copy of the
// same tone each: Flat (no settings), Quiet (-17 dB, like Thunda in "Thunderstorm on the woods 8") and Dark (a
// 115 Hz low-pass band, like Thunda in Rain Inside). What reaches the speakers is measured, not the UI state.
// Needs the Remix build in ../noctivago-plugin-repos/noctivago-remix.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const RATE = 22050
let app
let page
let panel
const files = []

// A 4 s, ~390 Hz sine (div 9 at 22050 Hz): well above the 115 Hz low-pass.
const makeWav = (name) => {
  const file = path.join(os.tmpdir(), `noct-grpfilt-${name}-${process.pid}.wav`)
  const n = RATE * 4
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 9) * 6000), 44 + i * 2)
  fs.writeFileSync(file, buf)
  files.push(file)
  return file
}

// RMS in dB of what every audio context sends to its speakers right now (loudest context).
const levelDb = () => page.evaluate(() => {
  let best = -200
  for (const a of window.__taps || []) {
    const d = new Float32Array(a.fftSize)
    a.getFloatTimeDomainData(d)
    let sum = 0
    for (const v of d) sum += v * v
    best = Math.max(best, 20 * Math.log10(Math.sqrt(sum / d.length) || 1e-10))
  }
  return best
})

const row = (name) => panel.locator('.rx-mrow', { hasText: name })

async function openGroup(name) {
  const back = panel.getByRole('button', { name: /^Back to/ })
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(600) }
  await panel.locator('.rx-item', { hasText: name }).first().click({ timeout: 5000 })
  await page.waitForTimeout(800)
}

async function hear(play, stop) {
  await play.click()
  await page.waitForTimeout(1800)
  const db = await levelDb()
  await (stop ?? play).click()
  await page.waitForTimeout(500)
  return db
}

before(async () => {
  app = await launchApp({ plugins: ['remix'] })
  page = app.page
  // Tee everything that reaches a speaker into one analyser per audio context (as pitch.e2e.mjs does).
  await page.context().addInitScript(() => {
    const connect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const ctx = target.context
        if (!ctx.__tap) {
          ctx.__tap = ctx.createAnalyser()
          ctx.__tap.fftSize = 8192
          ;(window.__taps ||= []).push(ctx.__tap)
        }
        connect.call(this, ctx.__tap)
      }
      return connect.call(this, target, ...rest)
    }
  })
  const wavs = ['flat', 'quiet', 'dark'].map(makeWav)
  await page.evaluate(async (wavs) => {
    const n = window.noctivago
    const names = ['Tone flat', 'Tone quiet', 'Tone dark']
    for (let i = 0; i < 3; i++) await n.library.addSound({ path: wavs[i], name: names[i], keepCopy: true })
    const lib = await n.library.list()
    const [f, q, d] = names.map((name) => lib.find((s) => s.name === name))
    await n.presets.save({ name: 'Filter preset', sounds: [f, q, d].map((s) => ({ soundId: s.id, volume: 1 })) })
    const p = (await n.presets.list()).find((x) => x.name === 'Filter preset')
    await n.presets.updateGroups(p.id, [
      { name: 'Flat', soundIds: [f.id] },
      { name: 'Quiet', soundIds: [q.id], filters: { gainDb: -17 } },
      { name: 'Dark', soundIds: [d.id], filters: { eq: [{ freqHz: 115, gainDb: 0.7, q: 1, type: 'lowpass', slope: 'gentle', muted: false }] } }
    ])
    const saved = (await n.presets.list()).find((x) => x.name === 'Filter preset')
    if (saved.groups.find((g) => g.name === 'Quiet').filters.gainDb !== -17) throw new Error('group filters not saved')
  }, wavs)
  await page.reload()
  await page.waitForSelector('.sound-row')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Remix' }).click()
  await page.waitForTimeout(1000)
  panel = page.locator('.tab-panel:not(.hidden)')
  await panel.getByRole('button', { name: 'Group', exact: true }).first().click()
  await page.waitForTimeout(800)
  const sel = page.locator('#rx-in-preset select')
  if (await sel.count()) await sel.selectOption({ label: 'Filter preset' })
  await page.waitForTimeout(800)
})

after(async () => {
  await app?.close()
  for (const f of files) fs.rmSync(f, { force: true })
})

let flatDb
test('baseline: a member of a group with no settings is heard', async () => {
  await openGroup('Flat')
  flatDb = await hear(row('Tone flat').locator('.rx-mpv'))
  assert.ok(flatDb > -45, `tone heard at ${flatDb.toFixed(1)} dB`)
})

test("member row Play takes the group's gain (-17 dB)", async () => {
  await openGroup('Quiet')
  const db = await hear(row('Tone quiet').locator('.rx-mpv'))
  assert.ok(Math.abs(flatDb - db - 17) <= 3, `group gain: ${(db - flatDb).toFixed(1)} dB vs flat`)
})

test("member row Play takes the group's EQ (115 Hz low-pass)", async () => {
  await openGroup('Dark')
  const db = await hear(row('Tone dark').locator('.rx-mpv'))
  assert.ok(flatDb - db >= 10, `group low-pass: ${(db - flatDb).toFixed(1)} dB vs flat`)
})

test("group row Play takes the group's EQ too", async () => {
  const back = panel.getByRole('button', { name: /^Back to/ })
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(600) }
  const play = (name) => panel.locator('.rx-iw', { hasText: name }).locator('.rx-mpv')
  const flat = await hear(play('Flat'))
  const dark = await hear(play('Dark'))
  assert.ok(flat > -45, `flat group heard at ${flat.toFixed(1)} dB`)
  assert.ok(flat - dark >= 10, `group low-pass: ${(dark - flat).toFixed(1)} dB vs flat`)
})
