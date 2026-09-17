import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { parseYouTubeSearchResults } from '../src/main/ytdlp/searchResults.js'

function row(id, duration) {
  return JSON.stringify({ id, title: id, duration, url: `https://youtube.test/${id}` })
}

describe('parseYouTubeSearchResults', () => {
  test('keeps pagination open when a full page contains a filtered live stream', () => {
    const stdout = [row('recorded-1', 60), row('live', null), row('recorded-2', 90)].join('\n')

    const result = parseYouTubeSearchResults(stdout, 3)

    assert.deepEqual(result.results.map((item) => item.id), ['recorded-1', 'recorded-2'])
    assert.equal(result.hasMore, true)
  })
})
