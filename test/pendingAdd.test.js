import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pendingName, pendingRow, shortFailure } from '../src/renderer/tabs/mixer/domain/pendingAdd.js'

test('placeholder name: typed, else the file name, else the host', () => {
  assert.equal(pendingName('https://x.org/a/rain%20on%20tin.mp3', ''), 'rain on tin')
  assert.equal(pendingName('https://x.org/a/b', '  My rain '), 'My rain')
  assert.equal(pendingName('https://www.youtube.com/watch?v=abc'), 'youtube.com')
  assert.equal(pendingName('https://youtu.be/abc'), 'youtu.be')
  assert.equal(pendingName('https://sounds.example.com/'), 'sounds.example.com')
  assert.equal(pendingName('not a url'), 'New sound')
})

test('placeholder row: step, percent, done, failure', () => {
  assert.deepEqual(pendingRow({ state: 'working', percent: null, step: 'Asking yt-dlp…' }), { meta: 'Asking yt-dlp…', ring: null, tone: 'working' })
  assert.deepEqual(pendingRow({ state: 'working', percent: 41.6 }), { meta: 'Downloading… 42%', ring: 42, tone: 'working' })
  assert.equal(pendingRow({ state: 'working', percent: 140 }).ring, 100)
  assert.deepEqual(pendingRow({ state: 'done' }), { meta: 'Added', ring: 100, tone: 'done' })
  assert.equal(pendingRow({ state: 'fail', reason: 'This video is private.' }).meta, "Couldn't download: this video is private")
  assert.equal(pendingRow(null), null)
})

test('failure text drops the IPC wrapper and is cut to one line', () => {
  assert.equal(shortFailure("Error invoking remote method 'x': Error: The link is dead."), 'the link is dead')
  assert.equal(shortFailure(''), 'download failed')
  assert.equal(shortFailure('A'.repeat(80), 10), 'aAAAAAAAA…')
})
