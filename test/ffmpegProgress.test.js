import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFfmpegProgress, formatEta } from '../src/main/ytdlp/ffmpegProgress.js'

// A real chunk as the bundled ffmpeg prints it during a --download-sections
// transfer: several carriage-return-separated updates in one stderr write.
const CHUNK =
  'size=    1024kB time=00:01:06.62 bitrate= 125.9kbits/s speed=   2x    ' +
  'size=    1280kB time=00:01:25.20 bitrate= 123.1kbits/s speed=1.99x    '

test('reads the latest position in a chunk', () => {
  const progress = parseFfmpegProgress(CHUNK, 600)
  assert.equal(Math.round(progress.seconds), 85)
  assert.equal(Math.round(progress.percent), 14)
  assert.equal(progress.speed, 1.99)
})

test('estimates the wall-clock wait from ffmpeg speed', () => {
  const progress = parseFfmpegProgress('time=00:05:00.00 bitrate=1kbits/s speed=2x', 600)
  // 300 s of media left at 2x real time = 150 s of waiting.
  assert.equal(Math.round(progress.etaSeconds), 150)
  assert.equal(progress.etaText, '3 minutes')
})

test('no speed yet means no estimate, but still a percent', () => {
  const progress = parseFfmpegProgress('size=0kB time=00:00:30.00 bitrate=N/A', 600)
  assert.equal(Math.round(progress.percent), 5)
  assert.equal(progress.etaSeconds, null)
  assert.equal(progress.etaText, null)
})

test('ignores chunks with no progress line, and a missing total', () => {
  assert.equal(parseFfmpegProgress('[youtube] Extracting URL', 600), null)
  assert.equal(parseFfmpegProgress(CHUNK, 0), null)
})

test('clamps a section that overruns its requested length', () => {
  assert.equal(parseFfmpegProgress('time=00:10:02.00 speed=2x', 600).percent, 100)
})

test('formatEta rounds to friendly units', () => {
  assert.equal(formatEta(10), 'half a minute')
  assert.equal(formatEta(60), 'a minute')
  assert.equal(formatEta(310), '5 minutes')
  assert.equal(formatEta(null), null)
})
