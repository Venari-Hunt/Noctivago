import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTagSuggestion, matchingTags, mergeTypedTags, sideScrollDelta, wheelPosition, dragPosition } from '../src/renderer/tabs/mixer/domain/soundRow.js'
import { buildSoundListSections } from '../src/renderer/tabs/mixer/domain/soundList.js'

test('tag autocomplete only looks at the segment being typed and skips tags the sound has', () => {
  const all = ['Rain', 'Rainforest', 'Thunder']
  assert.deepEqual(matchingTags('thun, rai', all, ['Rain']), ['Rainforest'])
  assert.deepEqual(matchingTags('rain, ', all, []), [])
})

test('picking a suggestion replaces the last segment and arms the next one', () => {
  assert.equal(applyTagSuggestion('Thunder, rai', 'Rainforest'), 'Thunder, Rainforest, ')
})

test('typed tags merge with existing casing, and an empty entry cancels', () => {
  assert.deepEqual(mergeTypedTags('rain, Wind', ['Night'], ['Rain']), ['Night', 'Rain', 'Wind'])
  assert.equal(mergeTypedTags(' , ', ['Night'], []), null)
})

const playback = (over = {}) => ({
  included: new Set(),
  playing: new Set(),
  loading: new Set(),
  errors: new Map(),
  volumes: new Map(),
  mutedSounds: new Set(),
  soloedSoundId: null,
  groups: [],
  ...over
})

test('a sound in two tag sections gets a distinct row key in each', () => {
  const entries = [{ id: 'a', name: 'A', tags: ['Rain', 'Night'] }]
  const { sections } = buildSoundListSections(entries, playback(), { sortMode: 'name-asc', groupMode: 'tags' })
  const keys = sections.flatMap((s) => s.rows.map((r) => r.key))
  assert.equal(keys.length, 2)
  assert.equal(new Set(keys).size, 2)
})

test('custom order is draggable only while nothing splits the list into sections', () => {
  const entries = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  const view = { sortMode: 'custom', groupMode: 'none' }
  assert.equal(buildSoundListSections(entries, playback(), view).draggable, true)
  const playing = buildSoundListSections(entries, playback({ playing: new Set(['a']) }), view)
  assert.equal(playing.draggable, false)
  assert.deepEqual(playing.sections.map((s) => s.label), ['Now Playing', 'Everything Else'])
})

test('Sound Group view puts ungrouped sounds in the mix in their own section on top', () => {
  const entries = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D' }
  ]
  const groups = [{ id: 'g', name: 'Rain', soundIds: ['c'] }]
  const state = playback({ groups, playing: new Set(['b', 'c']), included: new Set(['a', 'b', 'c']) })
  const { sections } = buildSoundListSections(entries, state, { sortMode: 'name-asc', groupMode: 'sound-group' })
  assert.deepEqual(
    sections.map((s) => [s.label, s.rows.map((r) => r.entry.id)]),
    [['Playing (ungrouped)', ['a', 'b']], ['Rain', ['c']], ['Ungrouped', ['d']]]
  )
})

test('side-scroll: horizontal wheel or Shift+wheel counts, plain vertical scroll does not', () => {
  assert.equal(sideScrollDelta({ deltaX: 30, deltaY: 4 }), 30)
  assert.equal(sideScrollDelta({ deltaX: 0, deltaY: 60 }), 0)
  assert.equal(sideScrollDelta({ deltaX: 0, deltaY: 60, shiftKey: true }), 60)
  assert.equal(sideScrollDelta({ deltaX: 2, deltaY: 0, deltaMode: 1 }), 80)
})

test('knob gestures move the position and stop at both ends', () => {
  assert.equal(wheelPosition(0.5, 30), 0.51)
  assert.equal(wheelPosition(0.995, 300), 1)
  assert.equal(wheelPosition(0.01, -300), 0)
  assert.equal(dragPosition(0.5, 80), 1)
  assert.equal(dragPosition(0.5, -16), 0.4)
  assert.equal(dragPosition(0.5, 1000), 1)
})
