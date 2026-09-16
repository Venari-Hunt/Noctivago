import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { walkFilesRecursive } from '../src/main/folderWalk.js'

describe('walkFilesRecursive', () => {
  let root

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-folderwalk-'))
    fs.writeFileSync(path.join(root, 'a.txt'), 'a')
    fs.mkdirSync(path.join(root, 'Sub1'))
    fs.writeFileSync(path.join(root, 'Sub1', 'b.txt'), 'b')
    fs.mkdirSync(path.join(root, 'Sub1', 'Sub2'))
    fs.writeFileSync(path.join(root, 'Sub1', 'Sub2', 'c.txt'), 'c')
  })

  after(() => {
    // Remove the loopback junction first (if the cycle test created one) so
    // a recursive rm can't ever be tempted to follow it back into the tree
    // it's already deleting.
    try {
      fs.unlinkSync(path.join(root, 'Sub1', 'loopback'))
    } catch {
      // no cycle test ran, or already gone
    }
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('finds every file at every depth', async () => {
    const found = []
    await walkFilesRecursive(root, (dirent, parentDir) => found.push(path.join(parentDir, dirent.name)))
    assert.deepEqual(
      found.map((f) => path.relative(root, f)).sort(),
      ['Sub1\\Sub2\\c.txt', 'Sub1\\b.txt', 'a.txt'].sort()
    )
  })

  test('a directory junction cycle back to an ancestor does not loop forever or double-count files', async () => {
    fs.symlinkSync(root, path.join(root, 'Sub1', 'loopback'), 'junction')

    const found = []
    await walkFilesRecursive(root, (dirent, parentDir) => found.push(path.join(parentDir, dirent.name)))

    const names = found.map((f) => path.relative(root, f)).sort()
    assert.deepEqual(names, ['Sub1\\Sub2\\c.txt', 'Sub1\\b.txt', 'a.txt'].sort())
  })

  test('a missing root resolves cleanly with no files found', async () => {
    const found = []
    await walkFilesRecursive(path.join(root, 'does-not-exist'), (dirent, parentDir) =>
      found.push(path.join(parentDir, dirent.name))
    )
    assert.deepEqual(found, [])
  })

  test('onFile throwing on one file does not abort the rest of the walk', async () => {
    const found = []
    await walkFilesRecursive(root, (dirent, parentDir) => {
      if (dirent.name === 'b.txt') throw new Error('simulated permission error')
      found.push(path.join(parentDir, dirent.name))
    })
    assert.deepEqual(
      found.map((f) => path.relative(root, f)).sort(),
      ['Sub1\\Sub2\\c.txt', 'a.txt'].sort()
    )
  })
})
