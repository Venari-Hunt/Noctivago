import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// loopClip.js imports `app` from electron only to find userData - same stub
// loopClipSeam.test.js already uses.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
      if (spec === 'electron') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const app = { getPath: () => process.env.NOCTIVAGO_TEST_USERDATA, isPackaged: false }') }
      }
      return next(spec, ctx)
    }`)
)

const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')

let userData
let readWavDuration

// BUG FIX (v0.1.231, owner-reported real 9-hour export): readWavDuration
// used to fs.readFileSync the whole file just to read its header, which
// crashed outright once a long export's whole-mix/group reverb intermediate
// crossed Node's ~2GiB fs.readFileSync ceiling ("File size (5715360078) is
// greater than 2 GiB"). It now reads a bounded prefix instead, and also
// understands RF64 (the >4GiB WAV variant those same passes now write via
// -rf64 auto) so it doesn't misread the sentinel 'data' chunk size RF64
// leaves behind. These tests exercise the parsing logic directly against
// real ffmpeg-written files - small ones, so the suite stays fast; the
// actual >2GiB crash and the RF64 fix were separately verified by hand
// against real multi-GB files (see CLAUDE.md).
describe('readWavDuration', { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }, () => {
  before(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-wavdur-'))
    process.env.NOCTIVAGO_TEST_USERDATA = userData
    ;({ readWavDuration } = await import('../src/main/ffmpeg/loopClip.js'))
  })

  after(() => fs.rmSync(userData, { recursive: true, force: true }))

  test('reads a normal (classic RIFF) WAV correctly', () => {
    const file = path.join(userData, 'plain.wav')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', file])
    assert.ok(Math.abs(readWavDuration(file) - 3) < 0.01)
  })

  // RF64 marks the outer RIFF size and the 'data' chunk's own size as the
  // 0xFFFFFFFF sentinel and puts the real 64-bit sizes in a leading 'ds64'
  // chunk instead - forced here with -rf64 always so a small file still
  // genuinely exercises that format, without needing a multi-GB fixture.
  test('reads an RF64-formatted WAV (ds64 sentinel) correctly', () => {
    const file = path.join(userData, 'rf64.wav')
    execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '44100', '-ac', '2', '-rf64', 'always', '-c:a', 'pcm_s16le', file])
    // Confirm this is genuinely RF64 (the sentinel is actually present) -
    // otherwise the test would pass even if -rf64 were silently ignored.
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(4)
    fs.readSync(fd, head, 0, 4, 0)
    fs.closeSync(fd)
    assert.equal(head.toString('ascii'), 'RF64')
    assert.ok(Math.abs(readWavDuration(file) - 3) < 0.01)
  })

  test('a file with no data chunk within the scan window returns 0, not a throw', () => {
    const file = path.join(userData, 'truncated.wav')
    // A real RIFF/fmt header with nothing after it - no 'data' chunk at all.
    const buf = Buffer.alloc(44)
    buf.write('RIFF', 0)
    buf.writeUInt32LE(36, 4)
    buf.write('WAVE', 8)
    buf.write('fmt ', 12)
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(2, 22)
    buf.writeUInt32LE(44100, 24)
    buf.writeUInt32LE(44100 * 4, 28)
    buf.writeUInt16LE(4, 32)
    buf.writeUInt16LE(16, 34)
    fs.writeFileSync(file, buf)
    assert.equal(readWavDuration(file), 0)
  })
})
