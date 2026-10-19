import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { shouldOfferAutoStart, UPDATE_RESTART_WINDOW_MS } from '../src/main/sleepTimerLaunch.js'

const now = 1_000_000_000
const base = { autoStartEnabled: true, restored: false, restart: null, now }

describe('shouldOfferAutoStart', () => {
  test('a normal launch offers it when the option is on', () => {
    assert.equal(shouldOfferAutoStart(base), true)
    assert.equal(shouldOfferAutoStart({ ...base, autoStartEnabled: false }), false)
  })
  test('a restored running timer wins', () => {
    assert.equal(shouldOfferAutoStart({ ...base, restored: true }), false)
  })
  test('an update restart keeps "Don\'t start" (or no timer) as it was', () => {
    assert.equal(shouldOfferAutoStart({ ...base, restart: { at: now - 30_000, autoStartPending: false } }), false)
  })
  test('an update during the countdown shows the notice again', () => {
    assert.equal(shouldOfferAutoStart({ ...base, restart: { at: now - 30_000, autoStartPending: true } }), true)
  })
  test('a launch long after an update is a new session', () => {
    assert.equal(shouldOfferAutoStart({ ...base, restart: { at: now - UPDATE_RESTART_WINDOW_MS - 1, autoStartPending: false } }), true)
  })
})
