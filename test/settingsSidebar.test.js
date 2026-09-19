import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildSidebar, pluginPageId, OPTION_PAGES } from '../src/renderer/settings/domain/sidebar.js'
import { splitByKind, needsRestart } from '../src/renderer/settings/domain/pluginGroups.js'
import { addPluginSettingsPage, listPluginSettingsPages, subscribePluginSettingsPages } from '../src/renderer/settings/domain/pluginSettingsPages.js'

const described = [
  { id: 'remix', kind: 'core', manifest: { name: 'Remix' }, state: 'enabled', loaded: true },
  { id: 'export', kind: 'core', manifest: { name: 'Export' }, state: 'enabled', loaded: true },
  { id: 'rain', kind: 'community', manifest: { name: 'Rain tools' }, state: 'restricted', loaded: false }
]

describe('settings sidebar', () => {
  test('always starts with the Options pages', () => {
    assert.deepEqual(buildSidebar([], described), [{ label: 'Options', items: OPTION_PAGES }])
  })

  test('hides the Core plugins page when there are no core plugins', () => {
    const [options] = buildSidebar([], [described[2]])
    assert.deepEqual(options.items.map((p) => p.id), ['general', 'library', 'community-plugins'])
  })

  test('groups plugin pages by kind, sorted by title', () => {
    const groups = buildSidebar(
      [{ pluginId: 'remix', title: 'Remix' }, { pluginId: 'rain', title: 'Rain tools' }, { pluginId: 'export', title: 'Export' }],
      described
    )
    assert.deepEqual(groups.map((g) => g.label), ['Options', 'Core plugins', 'Community plugins'])
    assert.deepEqual(groups[1].items, [
      { id: pluginPageId('export'), title: 'Export' },
      { id: pluginPageId('remix'), title: 'Remix' }
    ])
    assert.deepEqual(groups[2].items, [{ id: pluginPageId('rain'), title: 'Rain tools' }])
  })
})

describe('plugin groups', () => {
  test('splits core and community, sorted by name', () => {
    const { core, community } = splitByKind(described)
    assert.deepEqual(core.map((p) => p.id), ['export', 'remix'])
    assert.deepEqual(community.map((p) => p.id), ['rain'])
  })

  test('needs a restart only when saved state differs from what is running', () => {
    assert.equal(needsRestart(described), false)
    assert.equal(needsRestart([{ ...described[0], state: 'disabled' }]), true)
    assert.equal(needsRestart([{ ...described[2], state: 'enabled' }]), true)
  })
})

describe('plugin settings pages', () => {
  test('one page per plugin; removing only removes that version', () => {
    let calls = 0
    const unsubscribe = subscribePluginSettingsPages(() => calls++)
    const removeFirst = addPluginSettingsPage('demo', { title: 'Demo', mount() {} })
    addPluginSettingsPage('demo', { title: 'Demo 2', mount() {} })
    removeFirst()
    assert.deepEqual(listPluginSettingsPages().map((p) => p.title), ['Demo 2'])
    assert.equal(calls, 2)
    unsubscribe()
  })

  test('refuses a page without mount()', () => {
    assert.throws(() => addPluginSettingsPage('bad', { title: 'Bad' }))
  })
})

test('the page list is the same array until something changes', () => {
  const before = listPluginSettingsPages()
  assert.equal(listPluginSettingsPages(), before)
  addPluginSettingsPage('stable', { title: 'Stable', mount() {} })
  assert.notEqual(listPluginSettingsPages(), before)
})
