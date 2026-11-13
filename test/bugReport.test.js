import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { tailLines, versionLines, buildReport, issueUrl, ISSUE_LOG_CHARS } from '../src/shared/bugReport.js'

describe('tailLines', () => {
  test('keeps the last N lines and drops trailing blanks', () => {
    assert.equal(tailLines('a\nb\r\nc\nd\n\n', 2), 'c\nd')
  })
  test('empty log gives an empty string', () => {
    assert.equal(tailLines(undefined), '')
  })
})

describe('report', () => {
  const plugins = [{ id: 'remix', name: 'Remix', version: '1.2.0' }, { id: 'x' }]
  test('lists app and plugin versions', () => {
    assert.equal(versionLines('0.1.279', plugins), 'Noctívago 0.1.279\nPlugins:\n- Remix 1.2.0\n- x ?')
  })
  test('copy report holds versions and the log', () => {
    const r = buildReport({ appVersion: '1', plugins: [], log: 'boom' })
    assert.ok(r.startsWith('Noctívago 1\n') && r.endsWith('boom'))
  })
  test('issue link cuts the log and decodes back to the body', () => {
    const url = issueUrl('https://github.com/o/r', { appVersion: '2', plugins, log: 'x'.repeat(50000) })
    assert.ok(url.startsWith('https://github.com/o/r/issues/new?body='))
    const body = decodeURIComponent(url.split('body=')[1])
    assert.ok(body.includes('Noctívago 2') && body.includes('Remix 1.2.0'))
    assert.ok(body.length < ISSUE_LOG_CHARS + 400)
  })
})
