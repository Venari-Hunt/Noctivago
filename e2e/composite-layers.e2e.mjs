// End-to-end: the Composite tab's layers (plan step 5). A layer row shows its name and file
// with M and S buttons; the Layer card has Layer name, Sound, Layer volume, Duplicate and
// Remove; layers drag to reorder; M/S change what Preview plays (and M what Make sound
// renders); a library sound dropped on the timeline adds a layer; composites saved before
// layer names still load. Needs the plugin built (main.js is gitignored).
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

const head = (i) => panel().locator(`.composite-side[data-index="${i}"]`)
const headName = (i) => head(i).locator('.cp-lname').innerText()
const headFile = (i) => head(i).locator('.cp-lsub').innerText()
const headNames = async () => {
  const n = await panel().locator('.composite-side').count()
  const out = []
  for (let i = 0; i < n; i++) out.push(await headName(i))
  return out
}
const laneCount = () => panel().locator('.composite-lane').count()
const clipOf = (i) => panel().locator(`.composite-lane[data-index="${i}"] .composite-clip`)
const nameField = () => panel().locator('#layer-name')
const mute = (i) => head(i).locator('.cp-mute')
const solo = (i) => head(i).locator('.cp-solo')
const undoBtn = () => panel().locator('#composite-undo')
const noFocus = () => page.evaluate(() => document.activeElement?.blur())
const key = async (k) => {
  await page.keyboard.press(k)
  await settle(150)
}

async function pickSound(i, label) {
  await head(i).click()
  await panel().locator('#layer-sound').selectOption({ label })
  await settle(700)
}

async function newComposite() {
  await panel().getByRole('button', { name: 'New', exact: true }).click()
  await settle(300)
}

// A fresh composite: layer 1 = Tone A, layer 2 = Tone B.
async function twoLayers() {
  await newComposite()
  await pickSound(0, 'Tone A')
  await pickSound(1, 'Tone B')
}

// Drags layer header `from` to the row `to` (the header's own pointer drag, not HTML5 drag and drop).
async function dragHead(from, to) {
  const a = await head(from).boundingBox()
  const b = await head(to).boundingBox()
  const x = a.x + 100
  await page.mouse.move(x, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, a.y + a.height / 2 + (to > from ? 12 : -12), { steps: 3 })
  await page.mouse.move(x, b.y + b.height / 2, { steps: 6 })
  await page.mouse.up()
  await settle(300)
}

// Records which sounds Preview starts (it builds one media source per clip it plays).
async function previewedSounds() {
  await page.evaluate(() => {
    window.__pv = []
    if (!window.__pvHooked) {
      const orig = AudioContext.prototype.createMediaElementSource
      AudioContext.prototype.createMediaElementSource = function (el) {
        window.__pv.push(el.src)
        return orig.call(this, el)
      }
      window.__pvHooked = true
    }
  })
  await panel().locator('#composite-preview').click()
  await settle(300)
  const played = await page.evaluate(() => window.__pv.slice())
  if (await panel().locator('#composite-preview').getAttribute('aria-pressed') === 'true') await panel().locator('#composite-preview').click()
  await settle(200)
  return played
}

const compositeNamed = (name) =>
  page.evaluate((n) => window.noctivago.library.list().then((l) => l.find((e) => e.name === n)?.compositeSource ?? null), name)
const waitForComposite = (name) =>
  page.waitForFunction((n) => window.noctivago.library.list().then((l) => l.some((e) => e.name === n)), name, { timeout: 30000 })
const soundId = (name) => page.evaluate((n) => window.noctivago.library.list().then((l) => l.find((e) => e.name === n)?.id), name)

before(async () => {
  const dir = os.tmpdir()
  const a = path.join(dir, `noctivago-e2e-layers-a-${process.pid}.wav`)
  const b = path.join(dir, `noctivago-e2e-layers-b-${process.pid}.wav`)
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

describe('Composite: layer rows and the Layer card', () => {
  test('a layer row shows its name and file, with M and S buttons that carry the mock\'s hints', async () => {
    await pickSound(0, 'Tone A')
    assert.equal(await headName(0), 'Tone A')
    assert.match(await headFile(0), /^noctivago-e2e-layers-a-\d+$/)
    assert.equal(await headName(1), 'Empty layer')
    assert.equal(await mute(0).innerText(), 'M')
    assert.equal(await solo(0).innerText(), 'S')
    assert.equal(await mute(0).getAttribute('title'), 'Mute: left out of Preview and Make sound')
    assert.equal(await solo(0).getAttribute('title'), 'Solo: hear only this layer in Preview')
    assert.equal(await head(0).getAttribute('title'), 'Drag to reorder')
  })

  test('the Layer card has Layer name, Sound, Layer volume, Duplicate and Remove', async () => {
    await head(0).click()
    const card = panel().locator('#composite-layer')
    assert.equal(await card.locator('label.cp-field', { hasText: 'Layer name' }).count(), 1)
    assert.equal(await nameField().inputValue(), 'Tone A')
    assert.equal(await card.locator('.cp-sound-name').innerText(), 'Tone A')
    assert.equal(await card.locator('label', { hasText: 'Layer volume' }).count(), 1)
    assert.equal(await card.locator('#layer-duplicate').innerText(), 'Duplicate')
    assert.equal(await card.locator('#layer-remove').innerText(), 'Remove')
    assert.equal(await card.locator('#layer-duplicate').getAttribute('title'), 'Duplicate this layer')
  })

  test('the Sound readout still changes the sound: clicking it opens the list', async () => {
    await head(1).click()
    assert.equal(await panel().locator('#composite-layer .cp-sound-name').innerText(), 'Pick a sound')
    await panel().locator('#layer-sound').selectOption({ label: 'Tone B' })
    await settle(700)
    assert.equal(await panel().locator('#composite-layer .cp-sound-name').innerText(), 'Tone B')
    assert.equal(await headName(1), 'Tone B')
    const box = await panel().locator('#composite-layer .cp-sound').boundingBox()
    const sel = await panel().locator('#layer-sound').boundingBox()
    assert.ok(Math.abs(sel.width - box.width) < 1 && Math.abs(sel.height - box.height) < 1, 'the list covers the whole readout')
  })

  test('renaming a layer shows in its row; emptying the field goes back to the sound\'s name; Escape keeps the old one', async () => {
    await head(0).click()
    await nameField().fill('Latch click')
    await nameField().press('Enter')
    await settle(200)
    assert.equal(await headName(0), 'Latch click')
    assert.match(await headFile(0), /^noctivago-e2e-layers-a-\d+$/, 'the file under the name does not change')
    assert.equal(await panel().locator('#composite-layer .cp-sound-name').innerText(), 'Tone A', 'the sound is still Tone A')
    await nameField().fill('Something else')
    await nameField().press('Escape')
    assert.equal(await nameField().inputValue(), 'Latch click')
    await nameField().fill('')
    await nameField().press('Enter')
    await settle(200)
    assert.equal(await headName(0), 'Tone A')
    assert.equal(await nameField().inputValue(), 'Tone A')
  })

  test('a rename is one undo step', async () => {
    await nameField().fill('Renamed')
    await nameField().press('Enter')
    await settle(200)
    assert.equal(await headName(0), 'Renamed')
    await noFocus()
    await key('Control+z')
    assert.equal(await headName(0), 'Tone A')
    await key('Control+y')
    assert.equal(await headName(0), 'Renamed')
    await nameField().fill('')
    await nameField().press('Enter')
    await settle(200)
  })

  test('the zoom slider is drawn like the faders, not with the browser\'s native look', async () => {
    const zoom = panel().locator('#composite-zoom')
    assert.match((await zoom.getAttribute('class')) ?? '', /cp-fader/)
    assert.equal(await zoom.evaluate((el) => getComputedStyle(el).appearance), 'none')
    assert.ok(await zoom.evaluate((el) => el.style.getPropertyValue('--p').endsWith('%')))
  })
})

describe('Composite: Duplicate', () => {
  test('Duplicate adds a copy under the layer, selects it and keeps timing and volume; Undo takes it away', async () => {
    await twoLayers()
    await clipOf(0).click({ position: { x: 40, y: 30 } })
    const start = await panel().locator('#csel-start').inputValue()
    await panel().locator('#layer-duplicate').click()
    await settle(500)
    assert.equal(await laneCount(), 3)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone A copy', 'Tone B'])
    assert.equal(await head(1).getAttribute('aria-selected'), 'true')
    assert.equal(await nameField().inputValue(), 'Tone A copy')
    assert.equal(await panel().locator('#csel-start').inputValue(), start)
    assert.equal(await clipOf(1).count(), 1)
    await noFocus()
    await key('Control+z')
    assert.equal(await laneCount(), 2)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
  })

  test('Duplicate on an empty layer makes another empty layer', async () => {
    await panel().getByRole('button', { name: 'Add layer' }).click()
    await settle(200)
    await panel().locator('#layer-duplicate').click()
    await settle(300)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B', 'Empty layer', 'Empty layer'])
  })
})

describe('Composite: reorder', () => {
  test('dragging a layer row moves the layer (name, clip and all) and the selection follows it', async () => {
    await twoLayers()
    await head(0).click()
    await dragHead(0, 1)
    assert.deepEqual(await headNames(), ['Tone B', 'Tone A'])
    assert.equal(await head(1).getAttribute('aria-selected'), 'true', 'still on Tone A')
    assert.equal(await nameField().inputValue(), 'Tone A')
    assert.equal(await clipOf(0).getAttribute('aria-label'), 'Clip: Tone B')
    assert.equal(await clipOf(1).getAttribute('aria-label'), 'Clip: Tone A')
  })

  test('a drag that goes nowhere changes nothing and makes no undo step; a real one undoes in one step', async () => {
    await twoLayers()
    await noFocus()
    const before = await undoBtn().isDisabled()
    await dragHead(0, 0)
    assert.equal(await undoBtn().isDisabled(), before)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
    await dragHead(1, 0)
    assert.deepEqual(await headNames(), ['Tone B', 'Tone A'])
    await key('Control+z')
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
    await key('Control+y')
    assert.deepEqual(await headNames(), ['Tone B', 'Tone A'])
  })

  test('a click on M does not start a drag', async () => {
    await twoLayers()
    await mute(0).click()
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
    await mute(0).click()
  })

  test('Alt+Down and Alt+Up on a focused row move it too', async () => {
    await twoLayers()
    await head(0).focus()
    await page.keyboard.press('Alt+ArrowDown')
    await settle(250)
    assert.deepEqual(await headNames(), ['Tone B', 'Tone A'])
    await page.keyboard.press('Alt+ArrowUp')
    await settle(250)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
  })

  test('a move keeps every clip\'s timing, and Make sound saves the layers in the new order', async () => {
    await twoLayers()
    await clipOf(0).click({ position: { x: 40, y: 30 } })
    await panel().locator('#csel-start').fill('0.5')
    await panel().locator('#csel-start').press('Tab')
    await settle(250)
    await dragHead(0, 1)
    assert.equal(await panel().locator('#csel-start').inputValue(), '0.50 s')
    await panel().locator('#composite-name').fill('E2E layers order')
    await panel().locator('#composite-bake').click()
    await waitForComposite('E2E layers order')
    await settle(600)
    const src = await compositeNamed('E2E layers order')
    assert.deepEqual(src.members.map((m) => m.delayMs), [0, 500])
  })
})

describe('Composite: mute and solo', () => {
  test('M and S toggle and show their state; a muted layer looks quiet', async () => {
    await twoLayers()
    assert.equal(await mute(0).getAttribute('aria-pressed'), 'false')
    await mute(0).click()
    assert.equal(await mute(0).getAttribute('aria-pressed'), 'true')
    assert.equal(await panel().locator('.composite-lane[data-index="0"]').getAttribute('class').then((c) => c.includes('cp-muted')), true)
    await solo(1).click()
    assert.equal(await solo(1).getAttribute('aria-pressed'), 'true')
    await mute(0).click()
    await solo(1).click()
    assert.equal(await mute(0).getAttribute('aria-pressed'), 'false')
    assert.equal(await solo(1).getAttribute('aria-pressed'), 'false')
  })

  test('Preview plays everything at first, then leaves out a muted layer', async () => {
    const all = await previewedSounds()
    assert.equal(all.length, 2)
    await mute(0).click()
    const less = await previewedSounds()
    assert.equal(less.length, 1)
    assert.equal(less[0], all[1], 'only layer 2 (Tone B) plays')
    await mute(0).click()
  })

  test('Solo plays only the soloed layers in Preview, and a muted layer stays silent even when soloed', async () => {
    const all = await previewedSounds()
    await solo(0).click()
    assert.deepEqual(await previewedSounds(), [all[0]])
    await solo(1).click()
    assert.equal((await previewedSounds()).length, 2, 'two soloed layers both play')
    await mute(1).click()
    assert.deepEqual(await previewedSounds(), [all[0]], 'a soloed but muted layer is silent')
    await mute(1).click()
    await solo(0).click()
    await solo(1).click()
    assert.equal((await previewedSounds()).length, 2)
  })

  test('with every layer muted Preview is off', async () => {
    await mute(0).click()
    await mute(1).click()
    assert.equal(await panel().locator('#composite-preview').isDisabled(), true)
    await mute(0).click()
    await mute(1).click()
    assert.equal(await panel().locator('#composite-preview').isDisabled(), false)
  })

  test('muting is undoable', async () => {
    await mute(0).click()
    await noFocus()
    await key('Control+z')
    assert.equal(await mute(0).getAttribute('aria-pressed'), 'false')
    await key('Control+y')
    assert.equal(await mute(0).getAttribute('aria-pressed'), 'true')
    await mute(0).click()
  })

  test('Make sound leaves out a muted layer and says so; solo does not change it', async () => {
    await twoLayers()
    await clipOf(0).click({ position: { x: 40, y: 30 } })
    await panel().locator('#layer-duplicate').click() // layer 2 = copy of Tone A
    await settle(400)
    await mute(1).click()
    await solo(2).click() // Preview-only
    await panel().locator('#composite-name').fill('E2E layers muted')
    await panel().locator('#composite-bake').click()
    await waitForComposite('E2E layers muted')
    await settle(500)
    const src = await compositeNamed('E2E layers muted')
    assert.equal(src.members.length, 2, 'Tone A and Tone B; the muted copy is not baked')
    assert.match(await panel().locator('#composite-status').innerText(), /A muted layer was left out/)
    await solo(2).click()
    await mute(1).click()
  })

  test('Make sound needs two layers that are not muted', async () => {
    await twoLayers()
    await mute(1).click()
    await panel().locator('#composite-name').fill('E2E layers one')
    await panel().locator('#composite-bake').click()
    await settle(300)
    assert.equal(await panel().locator('#composite-status').innerText(), 'Choose at least two sounds that are not muted.')
  })
})

describe('Composite: layer names are saved, old composites still load', () => {
  test('a layer name is saved with the composite and comes back when it is opened; an unnamed layer saves no name', async () => {
    await twoLayers()
    await head(0).click()
    await nameField().fill('Latch click')
    await nameField().press('Enter')
    await panel().locator('#composite-name').fill('E2E layers named')
    await panel().locator('#composite-bake').click()
    await waitForComposite('E2E layers named')
    await settle(600)
    const src = await compositeNamed('E2E layers named')
    assert.equal(src.members[0].name, 'Latch click')
    assert.equal('name' in src.members[1], false, 'Tone B kept its default name, so none is saved')
    await newComposite()
    await panel().locator('#composite-existing').selectOption({ label: 'E2E layers named' })
    await settle(900)
    assert.deepEqual(await headNames(), ['Latch click', 'Tone B'])
    assert.equal(await headFile(0).then((f) => /^noctivago-e2e-layers-a-\d+$/.test(f)), true)
  })

  test('a composite saved before layer names has no name field and opens with the sounds\' names', async () => {
    const [a, b] = [await soundId('Tone A'), await soundId('Tone B')]
    const made = await page.evaluate(
      ([x, y]) =>
        window.noctivago.composite.create({
          name: 'E2E layers old',
          members: [
            { soundId: x, delayMs: 0, inSec: 0, outSec: 3, volume: 1 },
            { soundId: y, delayMs: 250, inSec: 0, outSec: 3, volume: 0.8 }
          ]
        }),
      [a, b]
    )
    assert.equal(made.ok, true)
    assert.equal('name' in (await compositeNamed('E2E layers old')).members[0], false)
    await newComposite()
    // The tab reloads the library when it is shown again.
    await page.locator('#tab-bar .tab-button', { hasText: 'Mixer' }).click()
    await settle(300)
    await page.locator('#tab-bar .tab-button', { hasText: 'Composite' }).click()
    await settle(900)
    await panel().locator('#composite-existing').selectOption({ label: 'E2E layers old' })
    await settle(900)
    assert.deepEqual(await headNames(), ['Tone A', 'Tone B'])
    await head(1).click()
    assert.equal(await nameField().inputValue(), 'Tone B')
    assert.equal(await panel().locator('#layer-volume-val').innerText(), '80%')
  })
})

describe('Composite: drop a library sound to add a layer', () => {
  // A library row carries the sound's id under this type; the timeline takes it.
  const TYPE = 'application/x-noctivago-mix-card'
  const fire = (type, id, target = '.cp-tl-body') =>
    page.evaluate(
      ([t, i, sel, mime]) => {
        const dt = new DataTransfer()
        if (i != null) dt.setData(mime, i)
        const el = document.querySelector(`.tab-panel:not(.hidden) ${sel}`)
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }))
      },
      [type, id, target, TYPE]
    )

  test('dropping Tone B on the timeline adds a layer with its clip and selects it; Undo removes it', async () => {
    await newComposite()
    await pickSound(0, 'Tone A')
    const id = await soundId('Tone B')
    assert.equal(await panel().locator('#composite-drop').innerText(), 'Drop a sound here from the library to add a layer')
    const before = await laneCount()
    await fire('dragover', id)
    assert.match((await panel().locator('#composite-drop').getAttribute('class')) ?? '', /cp-over/, 'the drop row lights up')
    await fire('drop', id, '#composite-drop')
    await settle(700)
    assert.equal(await laneCount(), before + 1)
    assert.equal(await headName(before), 'Tone B')
    assert.equal(await head(before).getAttribute('aria-selected'), 'true')
    assert.equal(await clipOf(before).count(), 1)
    assert.doesNotMatch((await panel().locator('#composite-drop').getAttribute('class')) ?? '', /cp-over/)
    await noFocus()
    await key('Control+z')
    assert.equal(await laneCount(), before)
  })

  test('something that is not a library sound adds nothing', async () => {
    const before = await laneCount()
    await fire('drop', 'no-such-sound', '#composite-drop')
    await fire('drop', null, '#composite-drop')
    await settle(300)
    assert.equal(await laneCount(), before)
  })

  test('a drag that is not a library sound does not light the drop row', async () => {
    await fire('dragover', null)
    assert.doesNotMatch((await panel().locator('#composite-drop').getAttribute('class')) ?? '', /cp-over/)
  })
})

describe('Composite: no errors', () => {
  test('the page raised no errors', () => {
    assert.deepEqual(problems, [])
  })
})
