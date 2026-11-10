import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { presetCardData, createdText } from '../src/renderer/tabs/mixer/domain/presetCard.js'

const lib = new Map([
  ['a', { playMode: 'loop', tags: ['Rain', 'Wind'] }],
  ['b', { playMode: 'loop', tags: ['Rain'] }],
  ['c', { playMode: 'scatter', tags: ['frog'] }],
  ['d', { playMode: 'scheduled', tags: ['bell'] }]
])

describe('presetCardData', () => {
  const preset = {
    id: 'p1',
    name: 'Rain Inside',
    createdAt: '2026-09-05T12:00:00.000Z',
    sounds: [
      { soundId: 'c', volume: 1 },
      { soundId: 'a', volume: 0.5 },
      { soundId: 'b', volume: 1 },
      { soundId: 'gone', volume: 1 },
      { soundId: 'd', volume: 1 }
    ]
  }
  const card = presetCardData(preset, lib)

  test('counts sounds and modes, with the missing ones last', () => {
    assert.equal(card.countText, '5 sounds')
    assert.equal(card.modeText, '2 loops · 1 random · 1 scheduled · 1 missing')
  })

  test('one bar per sound still in the library: loops first, loudest first', () => {
    assert.equal(card.bars.length, 4)
    assert.deepEqual(card.bars.map((b) => b.event), [false, false, true, true])
    assert.ok(card.bars[0].height >= card.bars[1].height)
  })

  test('tags: most common first, at most three', () => {
    assert.deepEqual(card.tags, ['Rain', 'frog', 'Wind'])
  })

  test('a single sound reads "1 sound"; bars stay within 4..64 px', () => {
    const one = presetCardData({ id: 'x', name: 'x', sounds: [{ soundId: 'a', volume: 0 }] }, lib)
    assert.equal(one.countText, '1 sound')
    assert.equal(one.bars[0].height, 4)
  })

  test('createdText formats the day, blank when unknown', () => {
    assert.equal(createdText('2026-09-05T12:00:00.000Z'), 'Created Sep 5')
    assert.equal(createdText(undefined), '')
  })
})
