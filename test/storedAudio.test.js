import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// composite.js and library.js reach electron; same stub as
// loopClipSeam.test.js so the real bundled ffmpeg runs under node --test.
// electron-store becomes a plain in-memory store.
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

const ffmpeg = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')

let dir
let STORED_AUDIO_EXT, STORED_AUDIO_ARGS, outputFormatArgs

function run(args) {
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...args])
}

function decodedMd5(file) {
  return execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'md5', '-']).toString().trim()
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noctivago-stored-'))
  process.env.NOCTIVAGO_TEST_USERDATA = dir
  ;({ STORED_AUDIO_EXT, STORED_AUDIO_ARGS } = await import('../src/main/ffmpeg/storedAudio.js'))
  ;({ outputFormatArgs } = await import('../src/main/ffmpeg/composite.js'))
  // A lossy float source, like a recording or a downloaded stream.
  run(['-f', 'lavfi', '-i', 'anoisesrc=d=5:c=pink:a=0.3,aformat=channel_layouts=stereo', '-c:a', 'libopus', path.join(dir, 'src.webm')])
})

after(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('stored audio format', () => {
  test('decodes to exactly what the old 16-bit WAV held, in a smaller file', () => {
    const wav = path.join(dir, 'old.wav')
    const flac = path.join(dir, `new${STORED_AUDIO_EXT}`)
    run(['-i', path.join(dir, 'src.webm'), wav])
    run(['-i', path.join(dir, 'src.webm'), ...STORED_AUDIO_ARGS, flac])
    assert.equal(decodedMd5(flac), decodedMd5(wav))
    assert.ok(fs.statSync(flac).size < fs.statSync(wav).size * 0.8)
  })
})

describe('outputFormatArgs (Composite)', () => {
  test('a .flac composite renders FLAC through a .tmp path', () => {
    const out = path.join(dir, 'composite.flac.tmp')
    run(['-i', path.join(dir, 'src.webm'), ...outputFormatArgs('x/composite.flac'), out])
    assert.equal(fs.readFileSync(out).subarray(0, 4).toString('latin1'), 'fLaC')
  })

  test('an older .wav composite keeps rendering WAV', () => {
    const out = path.join(dir, 'composite.wav.tmp')
    run(['-i', path.join(dir, 'src.webm'), ...outputFormatArgs('x/composite.WAV'), out])
    assert.equal(fs.readFileSync(out).subarray(0, 4).toString('latin1'), 'RIFF')
  })
})

describe('removing a duplicated sound (library.remove)', () => {
  test('keeps the stored copy the other sound still uses, deletes it with the last one', async () => {
    const lib = await import('../src/main/library.js')
    const original = path.join(dir, 'import-me.wav')
    run(['-f', 'lavfi', '-i', 'sine=d=1', original])
    const a = lib.addSound({ path: original, name: 'A', keepCopy: true })
    const b = lib.duplicateSound(a.id, { name: 'B' })
    const stored = path.join(dir, 'sounds', a.storedFileName)
    assert.equal(b.storedFileName, a.storedFileName)

    lib.remove(a.id)
    assert.ok(fs.existsSync(stored), 'duplicate still plays from this file')
    assert.ok(lib.getPlaybackPathForId(b.id))

    lib.remove(b.id)
    assert.ok(!fs.existsSync(stored))
  })
})
