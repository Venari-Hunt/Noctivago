import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIMITS,
  validateMeta,
  parseListQuery,
  likePattern,
  looksLikeZip,
  isValidAuthorKey,
  isValidPresetId,
  rowToPreset,
  pickEvictions,
  parseRange,
  countsAsDownload
} from '../src/validate.js'

const base = { name: 'Rainy cabin', author: 'Ana', soundCount: 3, rightsConfirmed: true }

describe('validateMeta', () => {
  test('accepts a minimal valid upload', () => {
    const result = validateMeta(base)
    assert.equal(result.ok, true)
    assert.equal(result.meta.name, 'Rainy cabin')
    assert.deepEqual(result.meta.tags, [])
  })

  test('requires name, author, sounds and the rights checkbox', () => {
    assert.equal(validateMeta({ ...base, name: '   ' }).ok, false)
    assert.equal(validateMeta({ ...base, author: '' }).ok, false)
    assert.equal(validateMeta({ ...base, soundCount: 0 }).ok, false)
    assert.equal(validateMeta({ ...base, soundCount: 2.5 }).ok, false)
    assert.equal(validateMeta({ ...base, rightsConfirmed: 'yes' }).ok, false)
    assert.equal(validateMeta(null).ok, false)
  })

  test('trims, strips control characters and caps lengths', () => {
    const { meta } = validateMeta({
      ...base,
      name: `  A\u0000B\nC${'x'.repeat(200)}`,
      description: 'line one\nline two\u0007'
    })
    assert.ok(meta.name.startsWith('AB C'))
    assert.equal(meta.name.length, LIMITS.nameMax)
    assert.equal(meta.description, 'line one\nline two')
  })

  test('tags are lowercased, deduped and capped', () => {
    const tags = ['Rain', 'rain', ' Night ', '', ...Array.from({ length: 20 }, (_, i) => `t${i}`)]
    const { meta } = validateMeta({ ...base, tags })
    assert.deepEqual(meta.tags.slice(0, 2), ['rain', 'night'])
    assert.equal(meta.tags.length, LIMITS.tagCount)
  })
})

describe('parseListQuery', () => {
  test('defaults and clamps', () => {
    const q = parseListQuery(new URLSearchParams('page=-3&pageSize=9999&sort=evil;DROP'))
    assert.equal(q.page, 1)
    assert.equal(q.pageSize, LIMITS.pageSizeMax)
    assert.equal(q.sortKey, 'new')
  })

  test('accepts the popular sort', () => {
    assert.equal(parseListQuery(new URLSearchParams('sort=popular')).sortKey, 'popular')
  })
})

describe('likePattern', () => {
  test('escapes LIKE wildcards', () => {
    assert.equal(likePattern('100%_a\\b'), '%100\\%\\_a\\\\b%')
  })
})

describe('small validators', () => {
  test('zip signature', () => {
    assert.equal(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), true)
    assert.equal(looksLikeZip(new Uint8Array([0x7b, 0x22])), false)
  })

  test('author keys and preset ids', () => {
    assert.equal(isValidAuthorKey('a'.repeat(64)), true)
    assert.equal(isValidAuthorKey('A'.repeat(64)), false)
    assert.equal(isValidAuthorKey(null), false)
    assert.equal(isValidPresetId('0'.repeat(32)), true)
    assert.equal(isValidPresetId('../etc'), false)
  })

  test('rowToPreset survives bad tag JSON', () => {
    assert.deepEqual(rowToPreset({ id: 'x', tags: '{oops' }).tags, [])
  })
})

describe('pickEvictions', () => {
  const rows = [
    { id: 'old', size_bytes: 30, hidden: 0 },
    { id: 'mid', size_bytes: 30, hidden: 0 },
    { id: 'reported', size_bytes: 10, hidden: 1 },
    { id: 'new', size_bytes: 30, hidden: 0 }
  ]
  test('nothing to free deletes nothing', () => {
    assert.deepEqual(pickEvictions(rows, 0), [])
  })
  test('reported presets go first, then the oldest', () => {
    assert.deepEqual(pickEvictions(rows, 10), ['reported'])
    assert.deepEqual(pickEvictions(rows, 35), ['reported', 'old'])
    assert.deepEqual(pickEvictions(rows, 70), ['reported', 'old', 'mid'])
  })
  test('null when even everything is not enough', () => {
    assert.equal(pickEvictions(rows, 101), null)
  })
})

describe('parseRange', () => {
  test('no header reads the whole file', () => {
    assert.equal(parseRange(null), null)
  })
  test('the three single-range forms', () => {
    assert.deepEqual(parseRange('bytes=0-99'), { offset: 0, length: 100 })
    assert.deepEqual(parseRange('bytes=500-'), { offset: 500 })
    assert.deepEqual(parseRange('bytes=-65536'), { suffix: 65536 })
  })
  test('junk and several ranges are refused', () => {
    assert.equal(parseRange('bytes=-'), 'invalid')
    assert.equal(parseRange('bytes=9-3'), 'invalid')
    assert.equal(parseRange('bytes=0-1,5-9'), 'invalid')
    assert.equal(parseRange('items=0-9'), 'invalid')
  })
  test('the PC and the phone each count one download', () => {
    assert.equal(countsAsDownload(null), true)
    assert.equal(countsAsDownload({ suffix: 65536 }), true)
    assert.equal(countsAsDownload({ offset: 0, length: 100 }), false)
  })
})
