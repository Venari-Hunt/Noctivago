// End-to-end: Add from link closes the dialog at once and the download fills a placeholder row in
// the library rail, which becomes the real row (micro-interactions mock, row "Add a sound"); a
// failed link stays on the row with Retry and Remove. Uses a local server, no internet.
// Run: npm run build && npm run test:e2e
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const SHOT = process.env.ADD_LINK_SHOT // optional folder for pictures

// A 3 s, 8 kHz mono 16-bit sine as a WAV file.
function wav(seconds = 3, rate = 8000) {
  const n = seconds * rate
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2)
  return buf
}
const audio = wav()

// /slow-rain.wav arrives in pieces over about 1.5 s, so the placeholder is on screen a while.
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/slow-rain.wav')) {
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length })
    let off = 0
    const step = Math.ceil(audio.length / 6)
    const tick = () => {
      if (off >= audio.length) return res.end()
      res.write(audio.subarray(off, off + step))
      off += step
      setTimeout(tick, 250)
    }
    return tick()
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('gone')
})

let app
let page
let base

before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  app = await launchApp()
  page = app.page
  await app.dismissToasts()
})
after(async () => {
  await app?.close()
  server.close()
})

async function addLink(url) {
  await page.locator('.add-sound-menu-button, button[title*="Add sound"], button:has-text("Add sound")').first().click()
  await page.getByText('Add from link…').click()
  await page.locator('#add-link-url').fill(url)
  await page.locator('#add-link-confirm').click()
}
const pending = () => page.locator('.mx-pending')

describe('Add from link', () => {
  test('the dialog closes at once and a placeholder row shows the download', async () => {
    await addLink(`${base}/slow-rain.wav`)
    assert.ok(await page.locator('#add-link-dialog').evaluate((d) => d.classList.contains('hidden')), 'dialog closed')
    await pending().waitFor({ timeout: 2000 })
    assert.match(await pending().innerText(), /slow-rain/)
    if (SHOT) await pending().screenshot({ path: path.join(SHOT, '1-working.png') }).catch(() => {})
  })

  test('it becomes the real row, Added with a check, then the placeholder leaves', async () => {
    await page.locator('.mx-pending.done').waitFor({ timeout: 30000 })
    assert.match(await pending().innerText(), /Added/)
    if (SHOT) await pending().screenshot({ path: path.join(SHOT, '2-done.png') }).catch(() => {})
    await pending().waitFor({ state: 'detached', timeout: 4000 })
    await page.locator('.mx-item[data-id]', { hasText: 'slow-rain' }).waitFor()
  })

  test('a dead link stays on the row with Retry and Remove; Remove clears it', async () => {
    await addLink(`${base}/dead-link.wav`)
    await page.locator('.mx-pending.fail').waitFor({ timeout: 60000 })
    const text = await pending().innerText()
    assert.match(text, /Couldn't download/)
    await pending().getByRole('button', { name: 'Retry' }).waitFor()
    if (SHOT) await pending().screenshot({ path: path.join(SHOT, '3-failed.png') }).catch(() => {})
    await pending().getByRole('button', { name: 'Remove' }).click()
    await pending().waitFor({ state: 'detached', timeout: 2000 })
  })
})
