import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildRailRows, groupToggleIds } from '../src/renderer/tabs/mixer/domain/libraryRail.js'

const library = [
  { id: 'a', name: 'Rain on roof', playMode: 'loop', durationSeconds: 84 },
  { id: 'b', name: 'Thunder', playMode: 'scatter', durationSeconds: 7 },
  { id: 'c', name: 'Church bell', playMode: 'scheduled' },
  { id: 'd', name: 'Wind', playMode: 'loop', status: 'missing' }
]
const groups = [{ id: 'g1', name: 'Storm', soundIds: ['a', 'b', 'gone'] }]

describe('buildRailRows', () => {
  test('All lists every sound with length, play type and group', () => {
    const rows = buildRailRows(library, { included: new Set(['a']), groups })
    assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd'])
    assert.equal(rows[0].meta, '1:24 · Loop · Storm')
    assert.equal(rows[1].meta, '0:07 · Random · Storm')
    assert.equal(rows[2].meta, 'Scheduled')
    assert.equal(rows[0].in, true)
    assert.equal(rows[1].in, false)
    assert.equal(rows[3].missing, true)
  })

  test('In mix keeps only included sounds; search matches names', () => {
    assert.deepEqual(buildRailRows(library, { included: new Set(['a', 'c']), scope: 'In mix' }).map((r) => r.id), ['a', 'c'])
    assert.deepEqual(buildRailRows(library, { included: new Set(), query: ' THUN' }).map((r) => r.id), ['b'])
  })

  test('Groups lists groups with members in the mix, ignoring deleted sounds', () => {
    const [row] = buildRailRows(library, { included: new Set(['b']), groups, scope: 'Groups' })
    assert.equal(row.kind, 'group')
    assert.equal(row.meta, 'group · 1 of 2 in mix')
    assert.deepEqual(row.memberIds, ['a', 'b'])
    assert.equal(row.in, true)
  })
})

describe('groupToggleIds', () => {
  test('any member in → take those out; none in → put all in', () => {
    assert.deepEqual(groupToggleIds(['a', 'b'], new Set(['b'])), ['b'])
    assert.deepEqual(groupToggleIds(['a', 'b'], new Set()), ['a', 'b'])
  })
})
