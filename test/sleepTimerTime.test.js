import { test } from 'node:test'
import assert from 'node:assert/strict'
import { durationFromPrefs } from '../src/shared/sleepTimerTime.js'

const now = new Date(2026, 9, 9, 22, 0, 0)

test('"in" mode uses the remembered minutes', () => {
  assert.equal(durationFromPrefs({ sleepTimerMode: 'in', sleepTimerMinutes: 45 }, now), 2700)
})

test('"at" mode counts to the time today, or tomorrow if it has passed', () => {
  assert.equal(durationFromPrefs({ sleepTimerMode: 'at', sleepTimerTimeOfDay: '23:30' }, now), 5400)
  assert.equal(durationFromPrefs({ sleepTimerMode: 'at', sleepTimerTimeOfDay: '21:00' }, now), 23 * 3600)
})

test('invalid prefs give null', () => {
  assert.equal(durationFromPrefs({ sleepTimerMode: 'at', sleepTimerTimeOfDay: '' }, now), null)
  assert.equal(durationFromPrefs({ sleepTimerMode: 'in', sleepTimerMinutes: 0 }, now), null)
})
