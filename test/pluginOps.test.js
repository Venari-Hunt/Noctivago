import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginOpWords, shortReason } from '../src/renderer/settings/domain/pluginOps.js'

test('plugin op words follow the mock', () => {
  const i = pluginOpWords('install')
  assert.equal(i.working, 'Installing')
  assert.equal(i.done, 'Installed')
  const u = pluginOpWords('update', '1.3.0')
  assert.equal(u.working, 'Updating to v1.3.0')
  assert.equal(u.done, 'Updated to v1.3.0')
  assert.equal(pluginOpWords('update').working, 'Updating')
  assert.equal(pluginOpWords('remove').done, 'Removed')
  assert.equal(i.fail(new Error('Bad zip')), 'Bad zip')
})

test('short reasons fit the chip', () => {
  assert.equal(shortReason('TypeError: fetch failed'), 'Offline. Try again')
  assert.equal(shortReason('getaddrinfo ENOTFOUND github.com'), 'Offline. Try again')
  assert.equal(shortReason(''), 'Failed')
  assert.equal(shortReason('Download failed (HTTP 404) for http://127.0.0.1:1/x/manifest.json'), 'Release not found')
  assert.equal(shortReason('Download failed (HTTP 500) for https://github.com/a/b'), 'Download failed (HTTP 500)')
  assert.equal(shortReason('x'.repeat(50), 10), 'xxxxxxxxx…')
})
