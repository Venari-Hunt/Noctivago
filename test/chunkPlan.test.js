import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytesForSeconds, planChunks, isRangeFetchable, CHUNK_BYTES } from '../src/main/ytdlp/chunkPlan.js'

test('bytesForSeconds scales the file size to the wanted length, with a margin', () => {
  const info = { filesize: 100 * 1024 * 1024, duration: 1000 }
  const wanted = bytesForSeconds(info, 100)
  assert.ok(wanted > 10 * 1024 * 1024 && wanted < 12.5 * 1024 * 1024)
  assert.equal(bytesForSeconds(info, 0), info.filesize)
  assert.equal(bytesForSeconds(info, 5000), info.filesize)
})

test('bytesForSeconds falls back to the bitrate, and gives up without either', () => {
  assert.equal(bytesForSeconds({ abr: 128 }, 60), Math.ceil(16000 * 60 * 1.15) + 512 * 1024)
  assert.equal(bytesForSeconds({}, 60), null)
  assert.equal(bytesForSeconds({ abr: 128 }, 0), null)
})

test('planChunks covers every byte exactly once', () => {
  const chunks = planChunks(2.5 * CHUNK_BYTES)
  assert.equal(chunks.length, 3)
  assert.deepEqual(chunks[0], { start: 0, end: CHUNK_BYTES - 1 })
  assert.deepEqual(chunks[2], { start: 2 * CHUNK_BYTES, end: 2.5 * CHUNK_BYTES - 1 })
  assert.deepEqual(planChunks(0), [])
})

test('only plain http(s) formats can be range-fetched', () => {
  assert.equal(isRangeFetchable({ url: 'https://x', protocol: 'https' }), true)
  assert.equal(isRangeFetchable({ url: 'https://x', protocol: 'm3u8_native' }), false)
  assert.equal(isRangeFetchable({ protocol: 'https' }), false)
})
