import test from 'node:test'
import assert from 'node:assert/strict'
import { clampPageSize } from '../src/shared/pageSize.js'

test('clampPageSize', async (t) => {
    await t.test('returns the page size when it is within range', () => {
        assert.equal(clampPageSize(10, 15), 10)
    })

    await t.test('uses the fallback for non-numbers', () => {
        assert.equal(clampPageSize('hello', 15), 15)
    })

    await t.test('handles zero', () => {
        assert.equal(clampPageSize(0, 15), 15)
    })

    await t.test('clamps negative values to 1', () => {
        assert.equal(clampPageSize(-5, 15), 1)
    })

    await t.test('clamps values over 30 to 30', () => {
        assert.equal(clampPageSize(50, 15), 30)
    })
})