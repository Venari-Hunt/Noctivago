import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPRESS_SHARE,
  compressFraction,
  uploadFraction,
  heaviestSounds,
  tooLargeMessage
} from '../src/main/community/uploadReport.js'

const MB = 1024 * 1024

describe('compressFraction', () => {
  test('weights by original size', () => {
    assert.equal(compressFraction([30, 10], 0), 0)
    assert.equal(compressFraction([30, 10], 1), 0.75 * COMPRESS_SHARE)
    assert.equal(compressFraction([30, 10], 2), COMPRESS_SHARE)
  })

  test('falls back to counts when sizes are unknown', () => {
    assert.equal(compressFraction([0, 0], 1), 0.5 * COMPRESS_SHARE)
  })

  test('accepts a set of finished indexes, in any order', () => {
    assert.equal(compressFraction([30, 10], new Set([1])), 0.25 * COMPRESS_SHARE)
    assert.equal(compressFraction([30, 10], new Set([1, 0])), COMPRESS_SHARE)
  })

  test('nothing to compress is already done', () => {
    assert.equal(compressFraction([], 0), COMPRESS_SHARE)
  })
})

describe('uploadFraction', () => {
  test('fills the rest of the bar', () => {
    assert.equal(uploadFraction(0, 100), COMPRESS_SHARE)
    assert.equal(uploadFraction(100, 100), 1)
    assert.equal(uploadFraction(200, 100), 1)
  })
})

describe('heaviestSounds', () => {
  test('biggest compressed first, skipping Freesound sounds', () => {
    const sounds = [
      { name: 'Rain', afterBytes: 5 * MB },
      { name: 'Birds', afterBytes: null },
      { name: 'Fire', afterBytes: 20 * MB },
      { name: 'Wind', afterBytes: 1 * MB },
      { name: 'Frogs', afterBytes: 9 * MB }
    ]
    assert.deepEqual(
      heaviestSounds(sounds).map((s) => s.name),
      ['Fire', 'Frogs', 'Rain']
    )
  })
})

describe('tooLargeMessage', () => {
  test('names the total, the limit and the heaviest sounds', () => {
    const msg = tooLargeMessage(
      [
        { name: 'Fire', afterBytes: 40 * MB },
        { name: 'Rain', afterBytes: 20 * MB }
      ],
      60 * MB,
      50 * MB
    )
    assert.equal(
      msg,
      'This preset is 60.0 MB after compression; the limit is 50 MB. Heaviest: "Fire" (40.0 MB), "Rain" (20.0 MB). Cut them to 15 s, shorten or remove them, then try again.'
    )
  })
})
