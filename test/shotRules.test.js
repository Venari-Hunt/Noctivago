import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  randomGapSeconds,
  randomPitchSemitones,
  fadeSeconds,
  scheduleShotEnvelope,
  secondsUntilNextTrigger,
  scatterKey,
  scheduleKey
} from '../src/shared/shotRules.js'

describe('secondsUntilNextTrigger', () => {
  const now = new Date(2026, 9, 17, 11, 59, 30)

  test('fixed times pick the nearest one still ahead', () => {
    assert.equal(secondsUntilNextTrigger({ type: 'times', times: ['12:00', '00:00'] }, now), 30)
  })

  test('a time already passed today rolls to tomorrow', () => {
    assert.equal(secondsUntilNextTrigger({ type: 'times', times: ['11:00'] }, now), 23 * 3600 + 30)
  })

  test('an interval lands on the clock grid, not on app start', () => {
    assert.equal(secondsUntilNextTrigger({ type: 'interval', intervalMinutes: 60 }, now), 30)
    assert.equal(secondsUntilNextTrigger({ type: 'interval', intervalMinutes: 15 }, new Date(2026, 9, 17, 10, 7, 0)), 8 * 60)
  })

  test('no usable times means no trigger', () => {
    assert.equal(secondsUntilNextTrigger(null, now), null)
    assert.equal(secondsUntilNextTrigger({ type: 'times', times: [] }, now), null)
    assert.equal(secondsUntilNextTrigger({ type: 'times', times: ['bad'] }, now), null)
  })
})

describe('per-shot picks', () => {
  test('gap stays inside min..max', () => {
    for (let i = 0; i < 200; i++) {
      const g = randomGapSeconds({ minGapSeconds: 2, maxGapSeconds: 4 })
      assert.ok(g >= 2 && g <= 4)
    }
  })

  test('pitch 0/0 means no variation', () => {
    assert.equal(randomPitchSemitones({ minPitchSemitones: 0, maxPitchSemitones: 0 }), 0)
  })

  test('fades never overlap on a short shot', () => {
    assert.deepEqual(fadeSeconds({ fadeInMs: 3000, fadeOutMs: 3000 }, 2), { fadeInSeconds: 1, fadeOutSeconds: 1 })
  })

  test('envelope schedules 0 -> target -> 0', () => {
    const calls = []
    const param = {
      cancelScheduledValues: (t) => calls.push(['cancel', t]),
      setValueAtTime: (v, t) => calls.push(['set', v, t]),
      linearRampToValueAtTime: (v, t) => calls.push(['ramp', v, t])
    }
    scheduleShotEnvelope(param, 0.8, 10, 4, 1, 1)
    assert.deepEqual(calls, [['cancel', 10], ['set', 0, 10], ['ramp', 0.8, 11], ['set', 0.8, 13], ['ramp', 0, 14]])
  })
})

describe('config keys', () => {
  test('a missing field and its default give the same key', () => {
    assert.equal(scatterKey({}), scatterKey({ minGapSeconds: 5, maxGapSeconds: 35 }))
    assert.equal(scheduleKey({ times: ['12:00', '00:00'] }), scheduleKey({ type: 'times', times: ['00:00', '12:00'] }))
  })

  test('a changed field changes the key', () => {
    assert.notEqual(scatterKey({ minGapSeconds: 1 }), scatterKey({}))
  })
})

// The phone player (noctivago-mobile) imports these files directly, so they
// may only import each other: no Electron, Node built-ins or renderer code.
test('phone-facing shared rules import only other shared files', () => {
  const dir = path.join(import.meta.dirname, '../src/shared')
  for (const file of ['modulator.js', 'shotRules.js', 'equalPowerRamp.js', 'groupDrift.js', 'pan.js']) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const [, spec] of src.matchAll(/^import .* from '([^']+)'/gm)) {
      assert.match(spec, /^\.\/[\w]+\.js$/, `${file} imports ${spec}`)
    }
  }
})
