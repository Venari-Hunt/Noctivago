import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildPlugin, listBuildablePlugins, OUTPUT_FILE } from '../scripts/build-plugins.mjs'

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
