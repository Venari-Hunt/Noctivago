import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { OFFICIAL_PLUGINS, missingOfficialPlugins, needsPluginMigration, shouldShowRecommended } from '../src/shared/officialPlugins.js'
import { installPlugins, recommendedPlugins } from '../src/renderer/tabs/mixer/domain/recommendedPlugins.js'

const allIds = OFFICIAL_PLUGINS.map((p) => p.id)

describe('official plugins', () => {
  test('lists the five plugins that used to ship inside the app', () => {
    assert.deepEqual(allIds, ['remix', 'export', 'composite', 'browse-sounds', 'community'])
  })

  test('missingOfficialPlugins keeps list order', () => {
    assert.deepEqual(missingOfficialPlugins(['export', 'hello-world']).map((p) => p.id), ['remix', 'composite', 'browse-sounds', 'community'])
    assert.deepEqual(missingOfficialPlugins(allIds), [])
  })

  test('only people who used the app before the split are migrated', () => {
    assert.equal(needsPluginMigration({ migrated: false, lastRunVersion: '0.1.234', soundCount: 0 }), true)
    assert.equal(needsPluginMigration({ migrated: false, lastRunVersion: null, soundCount: 3 }), true)
    assert.equal(needsPluginMigration({ migrated: false, lastRunVersion: null, soundCount: 0 }), false)
    assert.equal(needsPluginMigration({ migrated: true, lastRunVersion: '0.1.234', soundCount: 3 }), false)
  })

  test('the Recommended card shows until dismissed, while something is missing', () => {
    assert.equal(shouldShowRecommended({ dismissed: false, installedIds: [] }), true)
    assert.equal(shouldShowRecommended({ dismissed: true, installedIds: [] }), false)
    assert.equal(shouldShowRecommended({ dismissed: false, installedIds: allIds }), false)
  })
})

function fakeApi({ installed = [], dismissed = false, failIds = [], listFails = false } = {}) {
  const calls = []
  return {
    calls,
    plugins: {
      list: async () => { calls.push('list'); return [] },
      describe: async () => installed.map((id) => ({ id }))
    },
    settings: { get: async () => ({ recommendedPluginsDismissed: dismissed }) },
    pluginStore: {
      list: async () => { if (listFails) throw new Error('offline') },
      install: async (id) => {
        calls.push(`install:${id}`)
        if (failIds.includes(id)) throw new Error(`no ${id}`)
      }
    }
  }
}

describe('Recommended plugins card', () => {
  test('offers what is missing, after plugins.list (the migration) settles', async () => {
    const api = fakeApi({ installed: ['remix'] })
    const offered = await recommendedPlugins(api)
    assert.equal(api.calls[0], 'list')
    assert.deepEqual(offered.map((p) => p.id), ['export', 'composite', 'browse-sounds', 'community'])
    assert.deepEqual(await recommendedPlugins(fakeApi({ dismissed: true })), [])
  })

  test('installs the chosen plugins in list order and reports failures', async () => {
    const api = fakeApi({ failIds: ['export'] })
    const progress = []
    const res = await installPlugins(api, ['community', 'export', 'remix'], (p) => progress.push(p.plugin.id))
    assert.deepEqual(progress, ['remix', 'export', 'community'])
    assert.deepEqual(res.installed, ['remix', 'community'])
    assert.deepEqual(res.failed.map((f) => f.id), ['export'])
  })

  test('an unreachable store list fails every chosen plugin without installing', async () => {
    const api = fakeApi({ listFails: true })
    const res = await installPlugins(api, ['remix', 'export'])
    assert.deepEqual(res.failed.map((f) => f.id), ['remix', 'export'])
    assert.equal(api.calls.filter((c) => c.startsWith('install')).length, 0)
  })
})
