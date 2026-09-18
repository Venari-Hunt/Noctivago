import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../src/shared/pluginManifest.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const valid = { id: 'my-plugin', name: 'Mine', version: '1.0.0', main: 'index.js' }

describe('validateManifest', () => {
  test('accepts a minimal manifest', () => {
    assert.deepEqual(validateManifest(valid), { ok: true, errors: [] })
  })

  test('accepts every optional field', () => {
    const full = { ...valid, mainProcess: 'main/index.js', styles: 'styles.css', description: 'd', author: 'a', minAppVersion: '0.2.0' }
    assert.equal(validateManifest(full).ok, true)
  })

  test('rejects a non-object', () => {
    for (const bad of [null, 'x', 3, []]) assert.equal(validateManifest(bad).ok, false)
  })

  test('reports every missing required field at once', () => {
    const { ok, errors } = validateManifest({})
    assert.equal(ok, false)
    assert.equal(errors.length, 4)
  })

  test('rejects an id that is not a valid host label', () => {
    for (const id of ['My-Plugin', 'my plugin', '-lead', 'a/b', 'a.b']) {
      assert.equal(validateManifest({ ...valid, id }).ok, false, id)
    }
  })

  test('rejects a malformed version or minAppVersion', () => {
    assert.equal(validateManifest({ ...valid, version: '1.0' }).ok, false)
    assert.equal(validateManifest({ ...valid, minAppVersion: 'latest' }).ok, false)
    assert.equal(validateManifest({ ...valid, version: '1.0.0-beta.1' }).ok, true)
  })

  test('rejects file paths that leave the plugin folder', () => {
    for (const p of ['../index.js', 'sub/../../x.js', '/abs.js', '\\abs.js', 'C:/x.js', 'sub\\..\\..\\x.js']) {
      assert.equal(validateManifest({ ...valid, mainProcess: p }).ok, false, p)
      assert.equal(validateManifest({ ...valid, main: p }).ok, false, p)
    }
  })

  test('rejects a wrong type on an optional field', () => {
    assert.equal(validateManifest({ ...valid, styles: 42 }).ok, false)
  })

  test('every bundled plugin manifest passes', () => {
    const root = path.join(HERE, '../plugins')
    for (const dir of fs.readdirSync(root)) {
      const manifestPath = path.join(root, dir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      const result = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
      assert.deepEqual(result.errors, [], dir)
    }
  })
})

// types/plugin.d.ts documents window.noctivago by hand. This catches a
// preload method added without a matching line in the contract.
test('types/plugin.d.ts lists every window.noctivago method', () => {
  const preload = fs.readFileSync(path.join(HERE, '../src/preload/index.js'), 'utf-8')
  const dts = fs.readFileSync(path.join(HERE, '../types/plugin.d.ts'), 'utf-8')
  const methods = [...preload.matchAll(/^\s+(\w+): (?:\(|async \()/gm)].map((m) => m[1])
  assert.ok(methods.length > 50, 'preload parse found too few methods')
  const missing = methods.filter((name) => !name.startsWith('set') && !new RegExp(`\\b${name}\\(`).test(dts))
  assert.deepEqual(missing, [])
})
