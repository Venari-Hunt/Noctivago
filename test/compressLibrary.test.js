import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compressionCandidates, applyFlacSwaps, flacNameFor } from '../src/main/compressLibraryCore.js'
import { compressView } from '../src/renderer/settings/domain/compressText.js'

// library.js reaches electron; same stub as storedAudio.test.js.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
      if (spec === 'electron') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const app = { getPath: () => process.env.NOCTIVAGO_TEST_USERDATA, isPackaged: false, getVersion: () => "0.0.0" }; export const dialog = {}; export const ipcMain = { on() {}, handle() {} }; export const shell = {}; export const BrowserWindow = { getAllWindows: () => [] }') }
      }
      if (spec === 'electron-store') {
        return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export default class { constructor(o) { this.data = structuredClone(o?.defaults ?? {}) } get(k) { return this.data[k] } set(k, v) { this.data[k] = v } }') }
      }
      return next(spec, ctx)
    }`)
)

const copied = (id, storedFileName) => ({ id, storageMode: 'copied', storedFileName })

describe('which files get compressed', () => {
  test('only WAV copies in the library, each shared file once', () => {
    const sounds = [
      copied('a', 'a.wav'),
      { ...copied('a2', 'a.wav') }, // a duplicate shares a's file
      copied('b', 'b.WAV'),
      copied('c', 'c.flac'),
      { id: 'd', storageMode: 'reference', storedFileName: null, originalPath: 'C:/Music/d.wav' }
    ]
    assert.deepEqual(compressionCandidates(sounds), ['a.wav', 'b.WAV'])
  })

  test('leaves out files waiting for the restart, earlier skips, and FLAC names already taken', () => {
    const sounds = [copied('a', 'a.wav'), copied('b', 'b.wav'), copied('c', 'c.wav'), copied('x', 'c.flac')]
    assert.deepEqual(compressionCandidates(sounds, [{ from: 'a.wav', to: 'a.flac' }], ['b.wav']), [])
  })

  test('FLAC name keeps the stored name', () => {
    assert.equal(flacNameFor('1234-abcd.WAV'), '1234-abcd.flac')
  })
})

describe('the swap at startup', () => {
  const io = (present) => ({ exists: (f) => present.includes(f), sizeOf: () => 500 })

  test('every sound using the WAV moves to the FLAC, and the WAV is deleted', () => {
    const sounds = [copied('a', 'a.wav'), copied('a2', 'a.wav'), copied('b', 'b.wav')]
    const r = applyFlacSwaps(sounds, [{ from: 'a.wav', to: 'a.flac' }], io(['a.flac']))
    assert.deepEqual(r.sounds.map((s) => s.storedFileName), ['a.flac', 'a.flac', 'b.wav'])
    assert.equal(r.sounds[0].fileSizeBytes, 500)
    assert.deepEqual(r.deleteFiles, ['a.wav'])
  })

  test('a sound deleted before the restart leaves only its FLAC to clean up', () => {
    const r = applyFlacSwaps([copied('b', 'b.wav')], [{ from: 'a.wav', to: 'a.flac' }], io(['a.flac']))
    assert.deepEqual(r.sounds.map((s) => s.storedFileName), ['b.wav'])
    assert.deepEqual(r.deleteFiles, ['a.flac'])
  })

  test('a missing FLAC keeps the WAV in use', () => {
    const r = applyFlacSwaps([copied('a', 'a.wav')], [{ from: 'a.wav', to: 'a.flac' }], io([]))
    assert.equal(r.sounds[0].storedFileName, 'a.wav')
    assert.deepEqual(r.deleteFiles, [])
  })
})

describe('Settings text', () => {
  test('before, during and after a run', () => {
    assert.deepEqual(compressView({ info: { count: 3, bytes: 300 * 1024 * 1024, pendingCount: 0 }, progress: null, result: null }), {
      status: '3 WAV files, 300.0 MB.',
      canStart: true,
      canRestart: false
    })
    assert.equal(compressView({ info: null, progress: { done: 1, total: 3 }, result: null }).status, 'Compressing 2 of 3…')
    const done = compressView({ info: { count: 0, bytes: 0, pendingCount: 2 }, progress: null, result: { converted: 2, skipped: 1, savedBytes: 150 * 1024 * 1024 } })
    assert.equal(done.status, "2 sounds compressed, freeing 150.0 MB. Restart Noctívago to finish. 1 file stayed WAV: FLAC can't hold them exactly, or wasn't smaller.")
    assert.equal(done.canRestart, true)
  })

  test('nothing to do, or only a restart left', () => {
    assert.deepEqual(compressView({ info: { count: 0, bytes: 0, pendingCount: 0 }, progress: null, result: null }), {
      status: 'No WAV sounds left to compress.',
      canStart: false,
      canRestart: false
    })
    const waiting = compressView({ info: { count: 0, bytes: 0, pendingCount: 1 }, progress: null, result: null })
    assert.equal(waiting.status, 'No WAV sounds left to compress. 1 compressed file waiting for a restart.')
    assert.equal(waiting.canRestart, true)
  })
})

const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const needsFfmpeg = { skip: !fs.existsSync(ffmpeg) && 'bundled ffmpeg not installed' }

describe('compressing a real library', needsFfmpeg, () => {
  let dir

  const md5 = (file) => execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-c:a', 'pcm_f64le', '-f', 'md5', '-']).toString().trim()

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-compress-'))
    process.env.NOCTIVAGO_TEST_USERDATA = dir
    const sounds = path.join(dir, 'sounds')
    fs.mkdirSync(sounds)
    const make = (name, codec) =>
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=3:c=pink:a=0.3,aformat=channel_layouts=stereo', '-c:a', codec, path.join(sounds, name)])
    make('s16.wav', 'pcm_s16le')
    make('s24.wav', 'pcm_s24le')
    make('f32.wav', 'pcm_f32le')
  })

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('16- and 24-bit WAVs become identical FLACs at the next start; float WAV stays', async () => {
    const library = await import('../src/main/library.js')
    const sounds = path.join(dir, 'sounds')
    const before = { s16: md5(path.join(sounds, 's16.wav')), s24: md5(path.join(sounds, 's24.wav')) }

    // Added the way the app adds a kept copy: <id>.wav in the sounds folder.
    for (const name of ['s16', 's24', 'f32']) {
      const tmp = path.join(dir, `${name}-src.wav`)
      fs.copyFileSync(path.join(sounds, `${name}.wav`), tmp)
    }
    const added = ['s16', 's24', 'f32'].map((name) => library.addSound({ path: path.join(dir, `${name}-src.wav`), name, keepCopy: true }))
    const info = library.compressionInfo()
    assert.equal(info.count, 3)

    const progress = []
    const result = await library.compressLibrarySounds((p) => progress.push(p))
    assert.equal(result.converted, 2)
    assert.equal(result.skipped, 1)
    assert.ok(result.savedBytes > 0)
    assert.deepEqual(progress.at(-1), { done: 3, total: 3 })

    // Nothing switches until the restart.
    assert.match(library.getPlaybackPathForId(added[0].id), /\.wav$/)
    assert.deepEqual(library.compressionInfo(), { count: 0, bytes: 0, pendingCount: 2, running: false })

    library.applyPendingFlacSwaps()
    const [s16, s24, f32] = added.map((s) => library.getPlaybackPathForId(s.id))
    assert.match(s16, /\.flac$/)
    assert.match(s24, /\.flac$/)
    assert.match(f32, /\.wav$/)
    assert.equal(md5(s16), before.s16)
    assert.equal(md5(s24), before.s24)
    assert.equal(fs.existsSync(path.join(sounds, `${added[0].id}.wav`)), false)
    assert.equal(library.compressionInfo().pendingCount, 0)
  })
})
