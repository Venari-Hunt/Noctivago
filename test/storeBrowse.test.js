import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { browsePlugins, formatCount, downloadsLabel } from '../src/renderer/settings/domain/storeBrowse.js'
import { parseMarkdown, parseInline, safeHref } from '../src/renderer/settings/domain/markdown.js'
import { normalizeStats } from '../src/shared/pluginStore.js'

const plugins = [
  { id: 'remix', name: 'Remix', author: 'Venari', description: 'Edit loops', downloads: 50, updated: 300, installed: { version: '1.0.0' } },
  { id: 'export', name: 'Export', author: 'Venari', description: 'Render a mix', downloads: 900, updated: null, installed: null },
  { id: 'rain', name: 'rain tools', author: 'Someone', description: 'More rain', downloads: 50, updated: 500, installed: null }
]
const ids = (list) => list.map((p) => p.id)

describe('browsePlugins', () => {
  test('sorts by downloads, ties by name', () => {
    assert.deepEqual(ids(browsePlugins(plugins)), ['export', 'rain', 'remix'])
  })
  test('sorts by name, ignoring case', () => {
    assert.deepEqual(ids(browsePlugins(plugins, { sort: 'name' })), ['export', 'rain', 'remix'])
  })
  test('sorts by recently updated, plugins without stats last', () => {
    assert.deepEqual(ids(browsePlugins(plugins, { sort: 'updated' })), ['rain', 'remix', 'export'])
  })
  test('searches name, author and description', () => {
    assert.deepEqual(ids(browsePlugins(plugins, { query: 'SOMEONE' })), ['rain'])
    assert.deepEqual(ids(browsePlugins(plugins, { query: 'mix' })), ['export', 'remix'])
  })
  test('installed only', () => {
    assert.deepEqual(ids(browsePlugins(plugins, { onlyInstalled: true })), ['remix'])
  })
  test('does not reorder the input', () => {
    browsePlugins(plugins, { sort: 'name' })
    assert.deepEqual(ids(plugins), ['remix', 'export', 'rain'])
  })
})

describe('formatCount', () => {
  test('short labels', () => {
    assert.equal(formatCount(0), '0')
    assert.equal(formatCount(950), '950')
    assert.equal(formatCount(1234), '1.2k')
    assert.equal(formatCount(12345), '12k')
    assert.equal(formatCount(1_234_567), '1.2M')
    assert.equal(downloadsLabel(1), '1 download')
    assert.equal(downloadsLabel(2), '2 downloads')
  })
})

describe('normalizeStats', () => {
  test('keeps downloads and updated per valid id', () => {
    assert.deepEqual(normalizeStats({ remix: { downloads: 12, updated: 1700000000000, '1.0.0': 12 }, 'Bad Id': { downloads: 3 } }), {
      remix: { downloads: 12, updated: 1700000000000 }
    })
  })
  test('bad values become 0 / null, bad files become {}', () => {
    assert.deepEqual(normalizeStats({ x: { downloads: 'lots', updated: -1 } }), { x: { downloads: 0, updated: null } })
    assert.deepEqual(normalizeStats([]), {})
    assert.deepEqual(normalizeStats(null), {})
  })
})

describe('README markdown', () => {
  const repo = 'Venari-Hunt/noctivago-remix'

  test('only http(s) links survive; relative links point at the repo', () => {
    assert.equal(safeHref('https://example.com/a', repo), 'https://example.com/a')
    assert.equal(safeHref('javascript:alert(1)', repo), null)
    assert.equal(safeHref('JavaScript:alert(1)', repo), null)
    assert.equal(safeHref('file:///C:/x', repo), null)
    assert.equal(safeHref('#usage', repo), null)
    assert.equal(safeHref('./docs/a.md', repo), 'https://github.com/Venari-Hunt/noctivago-remix/blob/HEAD/docs/a.md')
  })

  test('inline formatting', () => {
    assert.deepEqual(parseInline('a **b** *c* `d` [e](https://x.io) snake_case_name', repo), [
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.io/', children: [{ type: 'text', text: 'e' }] },
      { type: 'text', text: ' snake_case_name' }
    ])
  })

  test('unsafe links and raw HTML become plain text', () => {
    assert.deepEqual(parseInline('[click](javascript:alert(1)) <script>bad()</script><b>ok</b>', repo), [
      { type: 'text', text: 'click ok' }
    ])
  })

  test('images become links to the image', () => {
    assert.deepEqual(parseInline('![Shot](shot.png)', repo), [
      { type: 'link', href: 'https://github.com/Venari-Hunt/noctivago-remix/blob/HEAD/shot.png', children: [{ type: 'text', text: '[image: Shot]' }] }
    ])
  })

  test('blocks', () => {
    const md = [
      '# Remix',
      '<p align="center">',
      '<img src="x.png">',
      '</p>',
      '',
      'First line',
      'second line.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '',
      '> quoted',
      '',
      '```js',
      'const a = "<b>"',
      '```',
      '',
      '| A | B |',
      '|---|:-:|',
      '| 1 | 2 |',
      '',
      '---'
    ].join('\n')
    const types = parseMarkdown(md, repo).map((b) => b.type)
    assert.deepEqual(types, ['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'table', 'hr'])
    const blocks = parseMarkdown(md, repo)
    assert.deepEqual(blocks[1].inline, [{ type: 'text', text: 'First line second line.' }])
    assert.equal(blocks[2].items.length, 2)
    assert.equal(blocks[3].ordered, true)
    assert.equal(blocks[5].text, 'const a = "<b>"')
    assert.equal(blocks[6].rows.length, 2)
  })

  test('empty or missing text gives no blocks', () => {
    assert.deepEqual(parseMarkdown('', repo), [])
    assert.deepEqual(parseMarkdown(undefined, repo), [])
  })
})
