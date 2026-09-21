import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ytDlpErrorMessage } from '../src/main/ytdlp/errorMessage.js'

// Real tails captured from the bundled binary on 2026-09-21.
test('explains a live stream in plain words', () => {
  const tail = '[youtube] jfKfPfyJRdk: Downloading webpage\nERROR: [youtube] jfKfPfyJRdk: This live stream recording is not available.'
  assert.equal(ytDlpErrorMessage(tail), "That's a live stream, so there's no recording to import yet.")
})

test('explains an unavailable video', () => {
  const tail = 'ERROR: [youtube] BaW_jenozKc: This video is unavailable'
  assert.match(ytDlpErrorMessage(tail), /won't serve that video/)
})

test('points a bot check at the sign-in setting', () => {
  const tail = "ERROR: [youtube] abc: Sign in to confirm you're not a bot"
  assert.match(ytDlpErrorMessage(tail), /Sign in as/)
})

test('keeps an unrecognised reason, minus the extractor prefix and flag advice', () => {
  const tail = 'ERROR: [youtube] abc123: Requested format is not available. Use --list-formats for a list of available formats'
  assert.equal(ytDlpErrorMessage(tail), 'That video has no audio track this app can download.')
  const other = 'ERROR: [generic] xyz: Something entirely new went wrong. Use --list-formats for a list'
  assert.equal(ytDlpErrorMessage(other), 'Something entirely new went wrong.')
})

test('uses the last error when several are reported', () => {
  const tail = 'ERROR: [youtube] a: first thing\nERROR: [youtube] a: This video is unavailable'
  assert.match(ytDlpErrorMessage(tail), /won't serve that video/)
})

test('falls back when the tail has no ERROR line at all', () => {
  assert.equal(ytDlpErrorMessage('size=0kB time=00:00:01.00\n'), 'yt-dlp could not download that video.')
  assert.equal(ytDlpErrorMessage(''), 'yt-dlp could not download that video.')
})
