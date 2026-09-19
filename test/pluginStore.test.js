import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeListEntry, parseCatalog, releaseAssetNames, checkReleaseManifest, compareVersions, releaseFileUrl, supportsApp, pickCompatibleVersion } from '../src/shared/pluginStore.js'

const entry = { id: 'rain-tools', name: 'Rain tools', author: 'Ana', description: 'd', repo: 'ana/noctivago-rain' }
const manifest = { id: 'rain-tools', name: 'Rain tools', version: '1.2.0', main: 'main.js' }

describe('plugin list parsing', () => {
  test('keeps a valid entry, dropping unknown fields', () => {
    assert.deepEqual(normalizeListEntry({ ...entry, extra: 1 }), entry)
  })

  test('drops entries with a bad id, name or repo', () => {
    for (const bad of [
      { ...entry, id: 'Rain' },
      { ...entry, name: ' ' },
      { ...entry, repo: 'no-slash' },
      { ...entry, repo: 'a/b/c' },
      { ...entry, repo: 'a/..' },
      { ...entry, repo: 'https://github.com/a/b' },
      null
    ]) {
      assert.equal(normalizeListEntry(bad), null, JSON.stringify(bad))
    }
  })

  test('parseCatalog skips bad and duplicate entries', () => {
    const list = parseCatalog([entry, { id: 'x' }, { ...entry, name: 'Dupe' }])
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'Rain tools')
  })

  test('parseCatalog rejects a non-array', () => {
    assert.throws(() => parseCatalog({ plugins: [] }))
  })
})

describe('release manifest checks', () => {
  test('lists the files to download', () => {
    assert.deepEqual(releaseAssetNames({ ...manifest, styles: 'styles.css', mainProcess: 'node.js' }), ['main.js', 'styles.css', 'node.js'])
  })

  test('refuses files in subfolders or hidden files', () => {
    for (const main of ['dist/main.js', '.main.js', 'manifest.json']) {
      assert.throws(() => releaseAssetNames({ ...manifest, main }), main)
    }
  })

  test('refuses a manifest whose id differs from the list', () => {
    assert.throws(() => checkReleaseManifest(manifest, 'other-id'), /other-id/)
    assert.equal(checkReleaseManifest(manifest, 'rain-tools'), manifest)
  })

  test('refuses an invalid manifest', () => {
    assert.throws(() => checkReleaseManifest({ ...manifest, version: 'latest' }, 'rain-tools'))
  })
})

describe('compareVersions', () => {
  test('orders versions numerically', () => {
    assert.ok(compareVersions('1.10.0', '1.9.0') > 0)
    assert.ok(compareVersions('0.1.0', '0.2.0') < 0)
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  })

  test('a prerelease sorts before its release', () => {
    assert.ok(compareVersions('1.0.0-beta.1', '1.0.0') < 0)
    assert.ok(compareVersions('1.0.0', '1.0.0-beta.1') > 0)
  })
})

test('release files come from the latest GitHub release', () => {
  assert.equal(releaseFileUrl('ana/x', 'main.js'), 'https://github.com/ana/x/releases/latest/download/main.js')
})

test('an older release is read by its version tag', () => {
  assert.equal(releaseFileUrl('ana/x', 'main.js', '1.2.0'), 'https://github.com/ana/x/releases/download/1.2.0/main.js')
})

describe('app version compatibility', () => {
  test('a manifest without minAppVersion runs anywhere', () => {
    assert.ok(supportsApp({ version: '1.0.0' }, '0.1.0'))
  })

  test('minAppVersion is compared with the running app', () => {
    assert.ok(supportsApp({ minAppVersion: '0.1.230' }, '0.1.235'))
    assert.ok(supportsApp({ minAppVersion: '0.1.235' }, '0.1.235'))
    assert.ok(!supportsApp({ minAppVersion: '0.2.0' }, '0.1.235'))
  })

  test('versions.json picks the newest plugin version this app can run', () => {
    const versions = { '1.0.0': '0.1.100', '1.1.0': '0.1.200', '2.0.0': '0.2.0' }
    assert.equal(pickCompatibleVersion(versions, '0.1.235'), '1.1.0')
    assert.equal(pickCompatibleVersion(versions, '0.1.150'), '1.0.0')
    assert.equal(pickCompatibleVersion(versions, '0.3.0'), '2.0.0')
    assert.equal(pickCompatibleVersion(versions, '0.1.0'), null)
  })

  test('malformed versions.json entries are skipped', () => {
    assert.equal(pickCompatibleVersion({ latest: '0.1.0', '1.0.0': 5, '0.9.0': '0.1.0' }, '0.1.235'), '0.9.0')
    assert.equal(pickCompatibleVersion([], '0.1.235'), null)
    assert.equal(pickCompatibleVersion(null, '0.1.235'), null)
  })
})
