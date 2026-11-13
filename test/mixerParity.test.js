// Parity probe: every toolbar/menu function the old Mixer (v0.1.279, commit
// 435c747) had must still have a home in the new Mixer, or be listed in
// KNOWN_GAPS with a reason. A rebuild cannot silently drop one again: a lost
// function fails the test, and a gap that gets fixed must leave the list.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SORT_MODES, GROUP_MODES } from '../src/renderer/tabs/mixer/domain/soundList.js'
import { soundMenuItems, REMOVE_MENU_ITEM } from '../src/renderer/tabs/mixer/domain/soundMenu.js'

const MIXER = 'src/renderer/tabs/mixer'
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
const sources = walk(MIXER).filter((f) => !f.includes('domain'))
const ui = sources.map((f) => readFileSync(f, 'utf8')).join('\n')

// Old function -> proof it is reachable from the new UI (text the UI code must contain).
const OLD_FUNCTIONS = [
  ['Tag filter', /railTag/],
  ['Bulk select toggle', /bulk-select-toggle/],
  ['Bulk apply an effect preset', /bulk-select-preset/],
  ['Bulk done', /bulk-select-done/],
  ['Search sounds', /sound-search|Search/],
  ['Add sound menu', /mountAddSound/],
  ['Sound menu (right-click items)', /soundMenuItems\(/],
  ['Remove from library', /REMOVE_MENU_ITEM/],
  ['Add to preset menu', /presetMenuItems\(/],
  ['New group with this sound', /New group with this sound/],
  ['Remove from group', /Remove from group/],
  ['Edit in Remix', /Edit in Remix/],
  ['Group by (sort/group modes in the UI)', /SORT_MODES|GROUP_MODES/]
]

// Dropped on purpose or not rebuilt yet: each needs a reason. Fix one, delete its line.
const KNOWN_GAPS = {
  'Group by (sort/group modes in the UI)': 'Library sort (Z-A, recently added/created, custom) and group by (alphabetical, date, tags, sound group) have no control in the new rail; the center only has Arrange tabs and Sorting for the mix.'
}

for (const [name, proof] of OLD_FUNCTIONS) {
  test(`parity: "${name}" still has a home in the new Mixer`, (t) => {
    const found = proof.test(ui)
    if (name in KNOWN_GAPS) {
      assert.equal(found, false, `"${name}" is back: remove it from KNOWN_GAPS`)
      t.diagnostic(`known gap: ${KNOWN_GAPS[name]}`)
      return
    }
    assert.ok(found, `"${name}" from the old Mixer has no home in ${MIXER}. Rebuild it or add it to KNOWN_GAPS with a reason.`)
  })
}

test('parity: the old sound menu actions all still exist', () => {
  const labels = soundMenuItems({ included: true, soloed: false, muted: false, volume: 1, missing: false })
    .filter((i) => !i.separator)
    .map((i) => i.action)
  for (const a of ['toggleIncluded', 'toggleSolo', 'toggleMute', 'resetVolume', 'rename', 'editTags', 'duplicate', 'showInFolder']) {
    assert.ok(labels.includes(a), `sound menu lost "${a}"`)
  }
  assert.equal(REMOVE_MENU_ITEM.action, 'remove')
})

test('parity: the domain still defines every old sort and group mode', () => {
  assert.deepEqual(SORT_MODES.map((m) => m.value), ['name-asc', 'name-desc', 'date-added-desc', 'date-added-asc', 'date-created-desc', 'date-created-asc', 'custom'])
  assert.deepEqual(GROUP_MODES.map((m) => m.value), ['none', 'alphabetical', 'date-added', 'date-created', 'tags', 'sound-group'])
})
