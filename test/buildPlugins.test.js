import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildIslands,
  buildPlugin,
  findIslands,
  listBuildablePlugins,
  listIslandPlugins,
  ISLANDS_OUT_DIR,
  ISLANDS_SRC_DIR,
  OUTPUT_FILE
} from '../scripts/build-plugins.mjs'

test('listBuildablePlugins only picks plugins with a src/index entry', () => {
  const ids = listBuildablePlugins().map((p) => p.id)
  assert.ok(ids.includes('hello-react'))
  assert.ok(!ids.includes('hello-world'), 'plain-JS plugins are not built')
})

test('a JSX plugin builds to one self-contained ES module', async () => {
  // Built into a temp copy so the test never touches plugins/. It sits
  // inside the repo (not os.tmpdir()) so 'react' resolves from node_modules.
  const dir = fs.mkdtempSync(path.resolve('test/.tmp-buildplugin-'))
  fs.cpSync(path.resolve('plugins/hello-react/src'), path.join(dir, 'src'), { recursive: true })
  try {
    await buildPlugin({ id: 'hello-react', dir, entry: path.join(dir, 'src/index.jsx') })
    const out = fs.readFileSync(path.join(dir, OUTPUT_FILE), 'utf8')
    // The renderer can't resolve bare specifiers or read process.env.
    assert.doesNotMatch(out, /from\s*["']react(-dom)?(\/[\w-]+)?["']/)
    assert.doesNotMatch(out, /process\.env\.NODE_ENV/)
    assert.match(out, /export\s*\{[^}]*as default/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('listIslandPlugins picks plain-JS plugins with src/islands/*.jsx', () => {
  const ids = listIslandPlugins().map((p) => p.id)
  assert.ok(ids.includes('editor'), 'Remix has the FilterControls island')
  assert.ok(!ids.includes('hello-world'))
})

test('an island builds to a self-contained ES module exporting its mount function', async () => {
  const dir = fs.mkdtempSync(path.resolve('test/.tmp-buildislands-'))
  fs.cpSync(path.resolve('plugins/editor', ISLANDS_SRC_DIR), path.join(dir, ISLANDS_SRC_DIR), { recursive: true })
  try {
    await buildIslands({ id: 'editor', dir, islands: findIslands(dir) })
    const out = fs.readFileSync(path.join(dir, ISLANDS_OUT_DIR, 'FilterControls.js'), 'utf8')
    assert.doesNotMatch(out, /from\s*["']react(-dom)?(\/[\w-]+)?["']/)
    assert.doesNotMatch(out, /process\.env\.NODE_ENV/)
    assert.match(out, /export\s*\{[^}]*as mountFilterControls/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
