import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseFreesoundFileName, describeLicense, creditLine } from '../src/shared/credits.js'

describe('parseFreesoundFileName', () => {
  test("reads Freesound's own download name", () => {
    assert.deepEqual(parseFreesoundFileName('C:\\Downloads\\331589__kentspublicdomain__rain-on-roof.wav'), {
      freesoundId: 331589,
      username: 'kentspublicdomain',
      title: 'rain on roof',
      pageUrl: 'https://freesound.org/people/kentspublicdomain/sounds/331589/'
    })
  })

  test('keeps single underscores inside the username', () => {
    const parsed = parseFreesoundFileName('17012__the_bizniss__fire_crackle.mp3')
    assert.equal(parsed.username, 'the_bizniss')
    assert.equal(parsed.title, 'fire crackle')
  })

  test('drops an _optimized suffix from the title', () => {
    assert.equal(parseFreesoundFileName('G:/Audio/217186__bosk1__wind-at-door-howling-4_optimized.opus').title, 'wind at door howling 4')
  })

  test('ignores ordinary file names', () => {
    for (const name of ['fire.crackling.mp3', 'rain__heavy.wav', 'abc__user__name.wav', '12345_preview-lq.mp3']) {
      assert.equal(parseFreesoundFileName(name), null, name)
    }
  })
})

describe('describeLicense', () => {
  test('maps Creative Commons URLs and names', () => {
    assert.deepEqual(describeLicense('http://creativecommons.org/publicdomain/zero/1.0/'), { label: 'CC0 (public domain)', attribution: false })
    assert.deepEqual(describeLicense('https://creativecommons.org/licenses/by/4.0/'), { label: 'CC BY 4.0', attribution: true })
    assert.equal(describeLicense('http://creativecommons.org/licenses/by-nc/3.0/').label, 'CC BY-NC 3.0')
    assert.equal(describeLicense('Attribution NonCommercial 4.0').label, 'CC BY-NC 4.0')
    assert.equal(describeLicense('Creative Commons 0').attribution, false)
  })

  test('an unknown license still asks for credit', () => {
    assert.deepEqual(describeLicense(null), { label: 'license unknown', attribution: true })
  })
})

describe('creditLine', () => {
  test('credits a Freesound sound with author, license and link', () => {
    const line = creditLine('Fire', {
      type: 'freesound',
      freesoundId: 5,
      username: 'bob',
      title: 'Campfire',
      license: 'https://creativecommons.org/licenses/by/4.0/'
    })
    assert.equal(line, '"Campfire" by bob (Freesound) - CC BY 4.0 - https://freesound.org/people/bob/sounds/5/')
  })

  test('credits a link import and skips unknown local files', () => {
    assert.equal(creditLine('Storm', { type: 'url', url: 'https://youtu.be/x' }), '"Storm" - from https://youtu.be/x')
    assert.equal(creditLine('Mine', null), null)
  })
})

test("the Export plugin's copy matches src/shared/credits.js", () => {
  const shared = fs.readFileSync(new URL('../src/shared/credits.js', import.meta.url), 'utf8')
  const plugin = fs.readFileSync(new URL('../plugins/export/credits.js', import.meta.url), 'utf8')
  assert.equal(plugin.split('\n').slice(2).join('\n'), shared)
})
