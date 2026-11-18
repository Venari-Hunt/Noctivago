// End-to-end: the Composite tab's editing, as it behaves today (guard tests for the
// rework, so a later change shows up here). Drag a clip, trim both edges, type in each
// field, the lane fader, Add / Remove lane, and Edit existing -> Make sound (rebake).
// Known quirk, tested as-is: typing In changes only In (Start stays), while dragging
// the In handle also shifts Start. The rework plan (step 3) makes them agree.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp } from './launch.mjs'

const SOUND_SEC = 3
let app
let page
const wavs = []
const problems = []
const settle = (ms = 400) => page.waitForTimeout(ms)
const panel = () => page.locator('.tab-panel:not(.hidden)')

function writeTone(file, divisor) {
  const rate = 22050
  const n = rate * SOUND_SEC
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / divisor) * 3000), 44 + i * 2)
  fs.writeFileSync(file, buf)
}

const clip = (i) => panel().locator(`.composite-lane[data-index="${i}"] .composite-clip`)
const field = (id) => panel().locator(`#csel-${id}`)
const num = async (id) => parseFloat(await field(id).inputValue())
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} +-${tol}`)

async function setField(id, text) {
  await field(id).fill(text)
  await field(id).press('Tab') // blur fires "change"
  await settle(250)
}

// Drags from (x, y) by dx pixels, optionally with Ctrl held.
async function dragBy(x, y, dx, { ctrl = false } = {}) {
  await page.mouse.move(x, y)
  if (ctrl) await page.keyboard.down('Control')
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
  if (ctrl) await page.keyboard.up('Control')
  await settle(350)
}

// The clip box plus pixels per second (the clip is its trim window long).
async function clipGeometry(i) {
  const box = await clip(i).boundingBox()
  const len = (await num('out')) - (await num('in'))
  return { box, y: box.y + box.height / 2, pps: box.width / len }
}

async function resetClip0() {
  // Back to a clean full-length clip at 0 (re-picking the sound clears In/Out).
  await panel().locator('.composite-side[data-index="0"] select').selectOption({ label: 'Tone A' })
  await settle(600)
  await clip(0).click({ position: { x: 40, y: 30 } })
  await settle(300)
  await setField('start', '0')
}

before(async () => {
  const dir = os.tmpdir()
  const a = path.join(dir, `noctivago-e2e-comp-a-${process.pid}.wav`)
  const b = path.join(dir, `noctivago-e2e-comp-b-${process.pid}.wav`)
  wavs.push(a, b)
  writeTone(a, 20)
  writeTone(b, 9)
  app = await launchApp({ plugins: ['composite'] })
  page = app.page
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('broken-plugin') && !t.includes('sound:// stream error') && !t.includes('404')) problems.push(t)
  })
  await page.evaluate(async ([pa, pb]) => {
    await window.noctivago.library.addSound({ path: pa, name: 'Tone A', keepCopy: true })
    await window.noctivago.library.addSound({ path: pb, name: 'Tone B', keepCopy: true })
  }, [a, b])
  await page.reload()
  await page.waitForSelector('#tab-bar .tab-button')
  await app.dismissToasts()
  await page.locator('#tab-bar .tab-button', { hasText: 'Composite' }).click()
  await settle(1200)
  await app.dismissToasts()
  const selects = panel().locator('.composite-side select')
  await selects.nth(0).selectOption({ label: 'Tone A' })
  await settle(800)
  await selects.nth(1).selectOption({ label: 'Tone B' })
  await settle(800)
  await clip(0).click({ position: { x: 40, y: 30 } })
  await settle(300)
})
after(async () => {
  await app?.close()
  for (const f of wavs) fs.rmSync(f, { force: true })
})

describe('Composite: moving a clip', () => {
  test('a fresh clip is the whole sound at 0 s, 100% volume', async () => {
    assert.equal(await field('start').inputValue(), '0.00 s')
    assert.equal(await field('in').inputValue(), '0.00 s')
    near(await num('out'), SOUND_SEC, 0.02, 'Out')
    assert.equal(await field('volume').inputValue(), '100%')
  })

  test('dragging the clip snaps Start to 50 ms', async () => {
    const { box, y, pps } = await clipGeometry(0)
    const dx = Math.round(0.23 * pps) // about 230 ms: not on the grid
    const raw = (dx / pps) * 1000
    await dragBy(box.x + box.width / 2, y, dx)
    const startMs = Math.round((await num('start')) * 1000)
    assert.equal(startMs % 50, 0, `Start ${startMs} ms is on the 50 ms grid`)
    near(startMs, Math.round(raw / 50) * 50, 10, 'snapped Start')
  })

  test('dragging with Ctrl held does not snap', async () => {
    await resetClip0()
    const { box, y, pps } = await clipGeometry(0)
    const dx = Math.round(0.23 * pps)
    const raw = (dx / pps) * 1000
    await dragBy(box.x + box.width / 2, y, dx, { ctrl: true })
    const startMs = Math.round((await num('start')) * 1000)
    near(startMs, raw, 10, 'free Start')
    assert.notEqual(startMs % 50, 0, `Start ${startMs} ms is off the grid`)
  })

  test('Start never goes below 0', async () => {
    const { box, y } = await clipGeometry(0)
    await dragBy(box.x + box.width / 2, y, -2000)
    assert.equal(await field('start').inputValue(), '0.00 s')
  })
})

describe('Composite: trim handles', () => {
  test('dragging the In handle moves In and shifts Start by the same amount', async () => {
    await resetClip0()
    const { box, y, pps } = await clipGeometry(0)
    const dx = Math.round(0.5 * pps)
    const sec = dx / pps
    await dragBy(box.x + 4, y, dx)
    near(await num('in'), sec, 0.02, 'In')
    near(await num('start'), sec, 0.02, 'Start shifts with In')
    near(await num('out'), SOUND_SEC, 0.02, 'Out untouched')
  })

  test('the In handle stops 0.05 s before Out', async () => {
    const { box, y } = await clipGeometry(0)
    await dragBy(box.x + 4, y, 4000)
    const out = await num('out')
    near((await num('in')) , out - 0.05, 0.015, 'In stops at Out - 0.05')
  })

  test('dragging the Out handle left shortens the clip, Start and In stay', async () => {
    await resetClip0()
    const { box, y, pps } = await clipGeometry(0)
    const dx = -Math.round(1 * pps)
    await dragBy(box.x + box.width - 4, y, dx)
    near(await num('out'), SOUND_SEC + dx / pps, 0.02, 'Out')
    assert.equal(await field('in').inputValue(), '0.00 s')
    assert.equal(await field('start').inputValue(), '0.00 s')
  })

  test('the Out handle cannot go past the file length', async () => {
    const { box, y } = await clipGeometry(0)
    await dragBy(box.x + box.width - 4, y, 600)
    near(await num('out'), SOUND_SEC, 0.02, 'Out clamps at the file length')
  })

  test('the Out handle stops 0.05 s after In', async () => {
    const { box, y } = await clipGeometry(0)
    await dragBy(box.x + box.width - 4, y, -(box.width + 80))
    near(await num('out'), 0.05, 0.015, 'Out stops at In + 0.05')
  })
})

describe('Composite: typed fields', () => {
  test('Start commits on change; "0.5" reads back as 0.50 s', async () => {
    await resetClip0()
    await setField('start', '0.5')
    assert.equal(await field('start').inputValue(), '0.50 s')
    assert.equal(await panel().locator('.composite-clip').first().evaluate((el) => el.style.left !== '0px'), true)
  })

  test('Start with bad input goes back to the old value', async () => {
    await setField('start', 'abc')
    assert.equal(await field('start').inputValue(), '0.50 s')
  })

  test('Start never goes below 0', async () => {
    await setField('start', '-2')
    assert.equal(await field('start').inputValue(), '0.00 s')
  })

  test('In commits and changes only In (the drag path also moves Start; the typed path does not)', async () => {
    await setField('start', '0.5')
    await setField('in', '1.2')
    assert.equal(await field('in').inputValue(), '1.20 s')
    assert.equal(await field('start').inputValue(), '0.50 s')
    near(await num('out'), SOUND_SEC, 0.02, 'Out')
  })

  test('In with bad input reverts', async () => {
    await setField('in', 'nope')
    assert.equal(await field('in').inputValue(), '1.20 s')
  })

  test('In cannot pass Out minus 0.05 s', async () => {
    await setField('in', '99')
    near(await num('in'), (await num('out')) - 0.05, 0.015, 'In')
  })

  test('Out commits, stays above In + 0.05 s and below the file length', async () => {
    await resetClip0()
    await setField('out', '2')
    assert.equal(await field('out').inputValue(), '2.00 s')
    await setField('out', '99')
    near(await num('out'), SOUND_SEC, 0.02, 'Out clamps at the file length')
    await setField('out', '0')
    near(await num('out'), 0.05, 0.015, 'Out min')
  })

  test('Out with bad input reverts', async () => {
    await resetClip0()
    await setField('out', '2')
    await setField('out', '??')
    assert.equal(await field('out').inputValue(), '2.00 s')
  })

  test('Volume commits ("150" -> 150%), syncs the lane fader and caps at 200%', async () => {
    await setField('volume', '150')
    assert.equal(await field('volume').inputValue(), '150%')
    const lane = panel().locator('.composite-side[data-index="0"]')
    assert.equal(await lane.locator('.composite-side-vol-val').innerText(), '150%')
    near(Number(await lane.locator('.composite-side-volume').inputValue()), 1.5, 0.001, 'fader')
    await setField('volume', '500')
    assert.equal(await field('volume').inputValue(), '200%')
  })

  test('Volume with bad input reverts', async () => {
    await setField('volume', '75')
    await setField('volume', 'loud')
    assert.equal(await field('volume').inputValue(), '75%')
  })
})

describe('Composite: lane volume fader', () => {
  test('moving the lane fader updates its label and the Selected clip Volume', async () => {
    const lane = panel().locator('.composite-side[data-index="0"]')
    await lane.locator('.composite-side-volume').evaluate((el) => {
      el.value = '0.4'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle(200)
    assert.equal(await lane.locator('.composite-side-vol-val').innerText(), '40%')
    assert.equal(await field('volume').inputValue(), '40%')
  })
})

describe('Composite: Add lane / Remove lane', () => {
  test('Add lane appends an empty lane and selects it; Remove lane takes one away', async () => {
    assert.equal(await panel().locator('.composite-side').count(), 2)
    await panel().getByRole('button', { name: 'Add lane' }).click()
    await settle(300)
    assert.equal(await panel().locator('.composite-side').count(), 3)
    assert.ok(await panel().locator('.composite-side[data-index="2"].selected').isVisible())
    assert.ok((await panel().locator('.composite-lane[data-index="2"]').innerText()).includes('Pick a sound'))
    assert.ok(await panel().locator('#composite-selected').isHidden(), 'an empty lane has no Selected clip card')
    await panel().locator('.composite-side[data-index="2"] .composite-side-remove').click()
    await settle(300)
    assert.equal(await panel().locator('.composite-side').count(), 2)
  })

  test('Remove lane on a filled lane removes its clip', async () => {
    await panel().locator('.composite-side[data-index="0"] .composite-side-remove').click()
    await settle(300)
    assert.equal(await panel().locator('.composite-side').count(), 1)
    assert.equal(await panel().locator('.composite-clip').count(), 1) // Tone B's
    assert.ok((await clip(0).innerText()).includes('Tone B'))
  })
})

describe('Composite: Edit existing then Make sound', () => {
  let entryId
  const composites = () => page.evaluate(() => window.noctivago.library.list().then((l) => l.filter((e) => e.compositeSource).map((e) => ({ id: e.id, name: e.name, members: e.compositeSource.members }))))

  test('Make sound welds two lanes into a library entry', async () => {
    await panel().getByRole('button', { name: 'Add lane' }).click()
    await settle(300)
    await panel().locator('.composite-side[data-index="1"] select').selectOption({ label: 'Tone A' })
    await settle(800)
    await panel().locator('#composite-name').fill('E2E weld')
    await panel().getByRole('button', { name: 'Make sound' }).click()
    await page.waitForFunction(() => window.noctivago.library.list().then((l) => l.some((e) => e.name === 'E2E weld')), null, { timeout: 30000 })
    await settle(500)
    const list = await composites()
    assert.equal(list.length, 1)
    entryId = list[0].id
    assert.equal(list[0].members.length, 2)
  })

  test('Edit existing loads the lanes; changing one and Make sound rebakes the same entry', async () => {
    await panel().locator('#composite-existing').selectOption({ value: entryId })
    await settle(1000)
    assert.equal(await panel().locator('#composite-name').inputValue(), 'E2E weld')
    assert.equal(await panel().locator('.composite-side').count(), 2)
    await clip(1).click({ position: { x: 40, y: 30 } })
    await settle(300)
    await setField('start', '1.25')
    await panel().locator('#composite-name').fill('E2E weld v2')
    await panel().getByRole('button', { name: 'Make sound' }).click()
    await page.waitForFunction(() => window.noctivago.library.list().then((l) => l.some((e) => e.name === 'E2E weld v2')), null, { timeout: 30000 })
    await settle(500)
    const list = await composites()
    assert.equal(list.length, 1, 'rebake replaced the entry; no second composite')
    assert.equal(list[0].id, entryId)
    assert.equal(list[0].name, 'E2E weld v2')
    assert.equal(list[0].members[1].delayMs, 1250)
    assert.equal(await panel().locator('#composite-existing').inputValue(), entryId)
  })
})

describe('whole run', () => {
  test('no unexpected errors or failed requests', () => {
    assert.deepEqual(problems, [])
  })
})
