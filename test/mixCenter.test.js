// The Mixer studio center (mock-noctivago-mixer-studio): only in-mix cards,
// three arrangements, three sorts, and the dimmed "leaving" cards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMixSections, mixMeta } from '../src/renderer/tabs/mixer/domain/soundList.js'

const lib = [
  { id: 'a', name: 'Rain', playMode: 'loop' },
  { id: 'b', name: 'Owl', playMode: 'scatter' },
  { id: 'c', name: 'Bell', playMode: 'scheduled' },
  { id: 'd', name: 'Wind', playMode: 'loop' },
  { id: 'e', name: 'Frog', playMode: 'scatter' }
]
const playback = (over = {}) => ({
  included: new Set(['d', 'b', 'a', 'c']),
  playing: new Set(),
  loading: new Set(),
  errors: new Map(),
  volumes: new Map([['a', 0.2], ['b', 0.9], ['c', 0.5], ['d', 0.7]]),
  mutedSounds: new Set(),
  soloedSoundId: null,
  groups: [{ id: 'g1', name: 'Night', soundIds: ['b', 'e'] }, { id: 'g2', name: 'Air', soundIds: ['d'] }],
  ...over
})
const names = (sections) => sections.map((s) => [s.label, s.rows.map((r) => r.entry.name)])

test('All sounds lists only the mix, in the order the sounds went in', () => {
  assert.deepEqual(names(buildMixSections(lib, playback(), { arrange: 'all', sort: 'mix' })), [['In this mix', ['Wind', 'Owl', 'Rain', 'Bell']]])
})

test('Name and Loudest first sort the cards', () => {
  assert.deepEqual(names(buildMixSections(lib, playback(), { arrange: 'all', sort: 'name' }))[0][1], ['Bell', 'Owl', 'Rain', 'Wind'])
  assert.deepEqual(names(buildMixSections(lib, playback(), { arrange: 'all', sort: 'loudest' }))[0][1], ['Owl', 'Wind', 'Bell', 'Rain'])
})

test('By group: groups by name, "Not in a group" last, each group section carries its id', () => {
  const sections = buildMixSections(lib, playback(), { arrange: 'group', sort: 'mix' })
  assert.deepEqual(names(sections), [['Air', ['Wind']], ['Night', ['Owl']], ['Not in a group', ['Rain', 'Bell']]])
  assert.deepEqual(sections.map((s) => s.groupId ?? null), ['g2', 'g1', null])
})

test('By play type: Loop, Random, Scheduled, empty ones left out', () => {
  const p = playback({ included: new Set(['a', 'b']) })
  assert.deepEqual(names(buildMixSections(lib, p, { arrange: 'type', sort: 'mix' })), [['Loop', ['Rain']], ['Random', ['Owl']]])
})

test('a sound just taken out stays as a leaving card in its old place until cleared', () => {
  const p = playback({ included: new Set(['d', 'a']) })
  const sections = buildMixSections(lib, p, { arrange: 'all', sort: 'mix', leaving: new Set(['b']), order: ['d', 'b', 'a'] })
  assert.deepEqual(names(sections)[0][1], ['Wind', 'Owl', 'Rain'])
  const owl = sections[0].rows.find((r) => r.entry.id === 'b')
  assert.equal(owl.state.included, false)
  assert.equal(owl.state.leaving, true)
  assert.equal(sections[0].rows[0].state.leaving, false)
})

test('an empty mix gives no sections (the center shows its empty line)', () => {
  assert.deepEqual(buildMixSections(lib, playback({ included: new Set() }), { arrange: 'all', sort: 'mix' }), [])
})

test('the head meta counts sounds, groups and the ones that do not loop', () => {
  assert.equal(mixMeta(lib, playback()), '4 sounds · 2 groups · 2 random')
  assert.equal(mixMeta(lib, playback({ included: new Set(['a']) })), '1 sound · 0 groups · 0 random')
})
