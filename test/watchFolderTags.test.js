import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { tagsForWatchedFile } from '../src/main/watchFolderTags.js'

describe('tagsForWatchedFile', () => {
  const root = path.join('C:', 'Watched', 'Root')

  test('a file directly in the watched root gets no tags', () => {
    assert.deepEqual(tagsForWatchedFile(root, root), [])
  })

  test('one subfolder level becomes one tag', () => {
    assert.deepEqual(tagsForWatchedFile(root, path.join(root, 'Rain')), ['Rain'])
  })

  test('nested subfolders become one tag per level, outermost first', () => {
    assert.deepEqual(tagsForWatchedFile(root, path.join(root, 'Rain', 'Heavy')), ['Rain', 'Heavy'])
  })

  test('a directory outside the watched root returns no tags rather than a leaking ".." segment', () => {
    assert.deepEqual(tagsForWatchedFile(root, path.join('C:', 'Somewhere', 'Else')), [])
  })

  test('the watched root itself, given with a trailing separator, still yields no tags', () => {
    assert.deepEqual(tagsForWatchedFile(root + path.sep, root), [])
  })
})
