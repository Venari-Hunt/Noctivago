// End-to-end: the Composite tab's keyboard, snap toggle and undo/redo (plan step 4).
// Undo and Redo step through every change to the layers (a whole drag is one step, a held
// arrow key is one step); Snap is a toolbar toggle with Alt-drag skipping it once; the keys
// (arrows nudge, Del removes, Esc deselects, S, F, Space) never fire while typing in a field,
// and the keys list opens from the keys button. Needs the plugin built (main.js is gitignored).
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
const head = (i) => panel().locator(`.composite-side[data-index="${i}"]`)
const undoBtn = () => panel().locator('#composite-undo')
const redoBtn = () => panel().locator('#composite-redo')
const snapBtn = () => panel().locator('#composite-snap')
const startMs = async () => Math.round(parseFloat(await field('start').inputValue()) * 1000)
const noFocus = () => page.evaluate(() => document.activeElement?.blur())
const key = async (k) => {
  await page.keyboard.press(k)
  await settle(120)
}

async function pickSound(i, label) {
  await head(i).click()
  await panel().locator('#layer-sound').selectOption({ label })
}

async function setField(id, text) {
  await field(id).fill(text)
  await field(id).press('Tab')
  await settle(250)
}

// Drags from (x, y) by dx pixels, optionally holding a modifier key.
async function dragBy(x, y, dx, { hold = null } = {}) {
  await page.mouse.move(x, y)
  if (hold) await page.keyboard.down(hold)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
  if (hold) await page.keyboard.up(hold)
  await settle(350)
}

async function clipGeometry(i) {
  const box = await clip(i).boundingBox()
  const len = parseFloat(await field('out').inputValue()) - parseFloat(await field('in').inputValue())
  return { box, y: box.y + box.height / 2, pps: box.width / len }
}

// A clean selected clip 0 at 0 s (re-picking the sound clears In/Out).
async function resetClip0() {
  await pickSound(0, 'Tone A')
  await settle(600)
  await clip(0).click({ position: { x: 40, y: 30 } })
  await settle(300)
  await setField('start', '0')
  await noFocus()
}

before(async () => {
  const dir = os.tmpdir()
  const a = path.join(dir, `noctivago-e2e-keys-a-${process.pid}.wav`)
  const b = path.join(dir, `noctivago-e2e-keys-b-${process.pid}.wav`)
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
})
after(async () => {
  await app?.close()
  for (const f of wavs) fs.rmSync(f, { force: true })
})

describe('Composite: the tools row', () => {
  test('Undo, Redo, Snap and the keys button are there with the mock\'s labels and hints', async () => {
    assert.equal(await undoBtn().getAttribute('title'), 'Undo (Ctrl+Z)')
    assert.equal(await redoBtn().getAttribute('title'), 'Redo (Ctrl+Y)')
    assert.equal(await snapBtn().innerText(), 'Snap')
    assert.equal(await snapBtn().getAttribute('title'), 'Snap to 50 ms (S). Hold Alt while dragging to skip it.')
    assert.equal(await panel().locator('#composite-keys').getAttribute('aria-label'), 'Keyboard shortcuts')
    assert.equal(await panel().locator('#composite-fit').getAttribute('title'), 'Show the whole composite (F)')
  })

  test('a new composite has nothing to undo or redo', async () => {
    assert.equal(await undoBtn().isDisabled(), true)
    assert.equal(await redoBtn().isDisabled(), true)
  })

  test('the Starts at field carries the nudge-key tooltip', async () => {
    await pickSound(0, 'Tone A')
    await settle(800)
    await pickSound(1, 'Tone B')
    await settle(800)
    await clip(0).click({ position: { x: 40, y: 30 } })
    await settle(300)
    assert.equal(await panel().locator('label.cp-field', { hasText: 'Starts at' }).getAttribute('title'), 'Arrow keys nudge 10 ms, Shift+arrow 100 ms')
  })
})

describe('Composite: undo and redo', () => {
  test('picking sounds is undoable: Undo clears Tone B from layer 2, Redo brings it back', async () => {
    assert.equal(await undoBtn().isDisabled(), false)
    await undoBtn().click()
    await settle(250)
    assert.equal(await panel().locator('.composite-lane[data-index="1"] .composite-clip').count(), 0)
    assert.equal(await redoBtn().isDisabled(), false)
    await redoBtn().click()
    await settle(500)
    assert.equal(await panel().locator('.composite-lane[data-index="1"] .composite-clip').count(), 1)
  })

  test('a whole drag is one step: Ctrl+Z puts the clip back, Ctrl+Y moves it again', async () => {
    await resetClip0()
    const { box, y, pps } = await clipGeometry(0)
    await dragBy(box.x + box.width / 2, y, Math.round(0.6 * pps))
    const moved = await startMs()
    assert.ok(moved >= 500, `the drag moved the clip (${moved} ms)`)
    await key('Control+z')
    assert.equal(await startMs(), 0)
    await key('Control+y')
    assert.equal(await startMs(), moved)
    await key('Control+z')
    await key('Control+Shift+z')
    assert.equal(await startMs(), moved, 'Ctrl+Shift+Z also redoes')
  })

  test('a typed field is one step', async () => {
    await resetClip0()
    await setField('start', '1.5')
    await noFocus()
    await key('Control+z')
    assert.equal(await startMs(), 0)
    await key('Control+y')
    assert.equal(await startMs(), 1500)
  })

  test('a new change after Undo empties Redo', async () => {
    await key('Control+z')
    assert.equal(await redoBtn().isDisabled(), false)
    await setField('start', '0.25')
    await noFocus()
    assert.equal(await redoBtn().isDisabled(), true)
  })

  test('the volume fader is one step however long you drag it', async () => {
    await resetClip0()
    const slider = panel().locator('#csel-volume')
    await slider.evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      for (const v of ['0.9', '0.8', '0.7', '0.6']) {
        set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await settle(300)
    assert.equal(await panel().locator('#csel-volume-val').innerText(), '60%')
    await noFocus()
    await key('Control+z')
    assert.equal(await panel().locator('#csel-volume-val').innerText(), '100%')
  })

  test('Undo also brings back a removed layer, with its selection', async () => {
    const lanes = () => panel().locator('.composite-lane').count()
    const before = await lanes()
    await clip(1).click({ position: { x: 40, y: 30 } })
    await panel().locator('#layer-remove').click()
    await settle(300)
    assert.equal(await lanes(), before - 1)
    await key('Control+z')
    await settle(300)
    assert.equal(await lanes(), before)
    assert.equal(await panel().locator('.composite-lane[data-index="1"] .composite-clip').count(), 1)
  })

  test('opening another composite clears the history', async () => {
    await panel().getByRole('button', { name: 'New', exact: true }).click()
    await settle(300)
    assert.equal(await undoBtn().isDisabled(), true)
    assert.equal(await redoBtn().isDisabled(), true)
  })
})

describe('Composite: keyboard', () => {
  before(async () => {
    await pickSound(0, 'Tone A')
    await settle(800)
    await pickSound(1, 'Tone B')
    await settle(800)
    await clip(0).click({ position: { x: 40, y: 30 } })
    await settle(300)
    await noFocus()
  })

  test('arrow keys nudge 10 ms, Shift+arrow 100 ms, never below 0', async () => {
    await resetClip0()
    await setField('start', '1')
    await noFocus()
    await key('ArrowRight')
    assert.equal(await startMs(), 1010)
    await key('Shift+ArrowRight')
    assert.equal(await startMs(), 1110)
    await key('ArrowLeft')
    assert.equal(await startMs(), 1100)
    await setField('start', '0.005')
    await noFocus()
    await key('ArrowLeft')
    assert.equal(await startMs(), 0)
  })

  test('a run of nudges is one undo step', async () => {
    await setField('start', '1')
    await noFocus()
    await settle(800)
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await settle(200)
    assert.equal(await startMs(), 1050)
    await key('Control+z')
    assert.equal(await startMs(), 1000)
  })

  test('keys typed into a field belong to the field', async () => {
    await resetClip0()
    await setField('start', '1')
    const t = panel().locator('#csel-out')
    await t.focus()
    await key('ArrowLeft')
    await key('Delete')
    await key('s')
    await key('f')
    assert.equal(await startMs(), 1000)
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'true')
    assert.equal(await panel().locator('.composite-lane').count(), 2)
    // Ctrl+Z in a field is the field's own undo, not the composite's
    const label = panel().locator('#csel-start')
    await label.focus()
    await key('Control+z')
    assert.equal(await startMs(), 1000)
    await noFocus()
  })

  test('clicking a clip after typing in a field gives the keys back', async () => {
    await setField('start', '1')
    await clip(0).click({ position: { x: 40, y: 30 } })
    await settle(250)
    await key('ArrowRight')
    assert.equal(await startMs(), 1010)
  })

  test('Escape deselects; Delete removes the selected clip and Undo restores it', async () => {
    await clip(0).click({ position: { x: 40, y: 30 } })
    await settle(250)
    await noFocus()
    const lanes = () => panel().locator('.composite-lane').count()
    const before = await lanes()
    await key('Delete')
    assert.equal(await lanes(), before - 1)
    await key('Control+z')
    await settle(300)
    assert.equal(await lanes(), before)
    await clip(0).click({ position: { x: 40, y: 30 } })
    await settle(250)
    assert.equal(await field('start').count(), 1)
    await key('Escape')
    assert.equal(await field('start').count(), 0, 'no clip card once deselected')
    await key('Delete')
    assert.equal(await lanes(), before, 'Delete needs a selected clip')
  })

  test('F fits the whole composite', async () => {
    await clip(0).click({ position: { x: 40, y: 30 } })
    await panel().getByRole('button', { name: 'Zoom in' }).click()
    await panel().getByRole('button', { name: 'Zoom in' }).click()
    await panel().getByRole('button', { name: 'Zoom in' }).click()
    await settle(250)
    const zoomed = await panel().locator('.cp-zoom-val').innerText()
    await noFocus()
    await key('f')
    await settle(250)
    assert.notEqual(await panel().locator('.cp-zoom-val').innerText(), zoomed)
    assert.equal(await panel().locator('#composite-tl .cp-lanes').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
  })

  test('Space starts and stops Preview', async () => {
    await noFocus()
    await key(' ')
    assert.equal(await panel().locator('#composite-preview').innerText(), 'Stop')
    await key(' ')
    assert.equal(await panel().locator('#composite-preview').innerText(), 'Preview')
  })
})

describe('Composite: snap', () => {
  test('Snap starts on; the toolbar button and S both toggle it', async () => {
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'true')
    await snapBtn().click()
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'false')
    await noFocus()
    await key('s')
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'true')
  })

  test('with Snap on a drag lands on the 50 ms grid; with Snap off it does not', async () => {
    await resetClip0()
    let g = await clipGeometry(0)
    await dragBy(g.box.x + g.box.width / 2, g.y, Math.round(0.23 * g.pps))
    assert.equal((await startMs()) % 50, 0, 'snapped')
    await resetClip0()
    await snapBtn().click()
    g = await clipGeometry(0)
    await dragBy(g.box.x + g.box.width / 2, g.y, Math.round(0.23 * g.pps))
    const free = await startMs()
    assert.notEqual(free % 50, 0, `free (${free} ms)`)
    assert.ok(Math.abs(free - 230) <= 12, `follows the pointer (${free} ms)`)
    await snapBtn().click() // back on
  })

  test('holding Alt skips Snap for one drag only', async () => {
    await resetClip0()
    let g = await clipGeometry(0)
    await dragBy(g.box.x + g.box.width / 2, g.y, Math.round(0.23 * g.pps), { hold: 'Alt' })
    const free = await startMs()
    assert.notEqual(free % 50, 0, `Alt drag is free (${free} ms)`)
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'true', 'Snap stays on')
    await resetClip0()
    g = await clipGeometry(0)
    await dragBy(g.box.x + g.box.width / 2, g.y, Math.round(0.23 * g.pps))
    assert.equal((await startMs()) % 50, 0, 'the next plain drag snaps again')
  })
})

describe('Composite: the keys list', () => {
  test('the keys button opens the list; Escape and a click elsewhere close it', async () => {
    const list = panel().locator('#composite-keys-list')
    assert.equal(await list.count(), 0)
    await panel().locator('#composite-keys').click()
    assert.equal(await list.count(), 1)
    const text = await list.innerText()
    for (const line of ['Undo', 'Redo', 'Nudge the clip 10 ms', 'Nudge the clip 100 ms', 'Remove the selected clip', 'Snap on or off']) {
      assert.ok(text.includes(line), `lists "${line}"`)
    }
    await key('Escape')
    assert.equal(await list.count(), 0)
    await panel().locator('#composite-keys').click()
    assert.equal(await list.count(), 1)
    await panel().locator('.cp-corner').click()
    assert.equal(await list.count(), 0)
  })

  test('on another tab the Composite keys do nothing (S does not flip Snap)', async () => {
    await page.locator('#tab-bar .tab-button').nth(0).click()
    await settle(500)
    await noFocus()
    // Composite is hidden: S must not flip its Snap toggle.
    await key('s')
    await page.locator('#tab-bar .tab-button', { hasText: 'Composite' }).click()
    await settle(500)
    assert.equal(await snapBtn().getAttribute('aria-pressed'), 'true')
  })
})

describe('whole run', () => {
  test('no unexpected errors or failed requests', () => {
    assert.deepEqual(problems, [])
  })
})
