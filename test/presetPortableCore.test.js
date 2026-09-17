import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { remapGroups, isFreesoundSource, pickOverridable } from '../src/main/presetPortableCore.js'

describe('remapGroups', () => {
  const ids = new Map([
    [0, 'a'],
    [1, 'b'],
    [2, 'c']
  ])

  test('maps member indexes to sound ids and gives each group a fresh id', () => {
    const [group] = remapGroups([{ name: 'Rain', soundIndexes: [0, 2], filters: { gainDb: 3 } }], ids)
    assert.deepEqual(group.soundIds, ['a', 'c'])
    assert.equal(group.name, 'Rain')
    assert.deepEqual(group.filters, { gainDb: 3 })
    assert.match(group.id, /^[0-9a-f-]{36}$/)
  })

  test('drops unresolved members and groups left empty', () => {
    const groups = remapGroups(
      [
        { name: 'Gone', soundIndexes: [7] },
        { name: 'Partial', soundIndexes: [1, 9] }
      ],
      ids
    )
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].soundIds, ['b'])
  })

  test('a sound claimed by an earlier group is not added to a later one', () => {
    const groups = remapGroups(
      [
        { name: 'First', soundIndexes: [0, 1] },
        { name: 'Second', soundIndexes: [1, 2] }
      ],
      ids
    )
    assert.deepEqual(groups[0].soundIds, ['a', 'b'])
    assert.deepEqual(groups[1].soundIds, ['c'])
  })

  test('non-array or malformed input is tolerated', () => {
    assert.deepEqual(remapGroups(null, ids), [])
    assert.deepEqual(remapGroups([null, 'x', { soundIndexes: 'nope' }], ids), [])
  })
})

describe('isFreesoundSource', () => {
  test('accepts a Freesound source with a positive integer id', () => {
    assert.equal(isFreesoundSource({ type: 'freesound', freesoundId: 1234 }), true)
    assert.equal(isFreesoundSource({ type: 'freesound', freesoundId: '1234' }), true)
  })

  test('rejects anything else', () => {
    assert.equal(isFreesoundSource(null), false)
    assert.equal(isFreesoundSource({ type: 'url', freesoundId: 1 }), false)
    assert.equal(isFreesoundSource({ type: 'freesound', freesoundId: 0 }), false)
    assert.equal(isFreesoundSource({ type: 'freesound', freesoundId: 'abc' }), false)
    assert.equal(isFreesoundSource({ type: 'freesound', freesoundId: 1.5 }), false)
  })
})

describe('pickOverridable', () => {
  test('keeps only per-preset overridable keys', () => {
    const picked = pickOverridable({ loopStart: 1, filters: { gainDb: 2 }, fluctuation: { x: 1 }, tags: ['a'] })
    assert.deepEqual(picked, { loopStart: 1, filters: { gainDb: 2 } })
  })

  test('handles missing settings', () => {
    assert.deepEqual(pickOverridable(undefined), {})
  })
})
