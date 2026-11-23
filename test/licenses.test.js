import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseNotices } from '../src/renderer/settings/domain/licenses.js'

test('parseNotices splits the heading into name, source and license', () => {
  const [a, b] = parseNotices('# Title\n\nintro\n\n## FFmpeg (bundled binary, GPLv3)\n\nText A\n\n## Plain\n\nText B\n')
  assert.deepEqual(a, { name: 'FFmpeg', license: 'GPLv3', source: 'bundled binary', body: 'Text A' })
  assert.deepEqual(b, { name: 'Plain', license: '', source: '', body: 'Text B' })
})

test('the real THIRD_PARTY_NOTICES.md lists FFmpeg, yt-dlp and Signalsmith Stretch with licenses', () => {
  const entries = parseNotices(fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'))
  const names = entries.map((e) => e.name)
  for (const n of ['FFmpeg', 'yt-dlp', 'Signalsmith Stretch']) assert.ok(names.includes(n), n)
  assert.ok(entries.every((e) => e.license && e.body))
})
