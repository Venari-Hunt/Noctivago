import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTagSuggestion, matchingTags, mergeTypedTags } from '../src/renderer/tabs/mixer/domain/soundRow.js'
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
