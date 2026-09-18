import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isOfficialRepo, pluginKind, pluginLoadState, canInstallFromStore } from '../src/shared/pluginEnablement.js'

const core = { id: 'remix', source: 'bundled', repo: null }
const official = { id: 'export', source: 'user', repo: 'Venari-Hunt/noctivago-export' }
const thirdParty = { id: 'rain-tools', source: 'user', repo: 'ana/noctivago-rain' }
const handDropped = { id: 'mystery', source: 'user', repo: null }

describe('official repos', () => {
  test('matches the Venari-Hunt owner, any case', () => {
    assert.equal(isOfficialRepo('Venari-Hunt/x'), true)
    assert.equal(isOfficialRepo('venari-hunt/x'), true)
  })

  test('rejects other owners, look-alikes and missing repos', () => {
    for (const repo of ['ana/x', 'Venari-Hunt-fake/x', null, undefined, '']) {
      assert.equal(isOfficialRepo(repo), false, String(repo))
    }
  })
})

describe('load state', () => {
  test('bundled plugins are core, installed ones community', () => {
    assert.equal(pluginKind(core), 'core')
    assert.equal(pluginKind(official), 'community')
  })

  test('everything loads by default except third-party plugins', () => {
    assert.equal(pluginLoadState(core), 'enabled')
    assert.equal(pluginLoadState(official), 'enabled')
    assert.equal(pluginLoadState(thirdParty), 'restricted')
    assert.equal(pluginLoadState(handDropped), 'restricted')
  })

  test('turning Restricted mode off lets third-party plugins load', () => {
    assert.equal(pluginLoadState(thirdParty, { restrictedMode: false }), 'enabled')
  })

  test('a switched-off plugin stays off either way', () => {
    for (const p of [core, official, thirdParty]) {
      assert.equal(pluginLoadState(p, { disabledIds: [p.id], restrictedMode: false }), 'disabled')
    }
  })

  test('store installs: official always, third-party only when unrestricted', () => {
    assert.equal(canInstallFromStore(official.repo), true)
    assert.equal(canInstallFromStore(thirdParty.repo), false)
    assert.equal(canInstallFromStore(thirdParty.repo, { restrictedMode: false }), true)
  })
})
