import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildPortableBundle, packPortableBundle } from '../presetPortable.js'
import os from 'node:os'
import { runFfmpegToFile } from '../ffmpeg/runFfmpeg.js'
import { mapPool } from '../ffmpeg/mapPool.js'
import { compressFraction, tooLargeMessage } from './uploadReport.js'
import { applySoundOverride } from '../../shared/constants.js'
import { CUT_SECONDS, canCut, cutWindow, loopSeconds, shiftForCut } from './cutClip.js'

// Builds the .ncvpreset a community upload sends. Two differences from a
// local "Export preset" file, both to keep uploads small:
//   - Freesound sounds carry no audio (the recipient re-downloads them by id).
//   - Every other sound is re-encoded to Opus at OPUS_BITRATE before packing.
//     Loop points, envelopes and schedules are in seconds, so a re-encode
//     leaves them valid.
//   - Sounds listed in cutSounds ship only the middle 15 s of their loop
//     (see cutClip.js).

// Must match community/src/validate.js's maxBundleBytes.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const OPUS_BITRATE = '96k'

// One Opus encode is single-threaded and light on memory; leave a core free
// so the app stays responsive.
function encodeConcurrency() {
  return Math.max(1, Math.min(8, (os.cpus()?.length ?? 2) - 1))
}

function tmpRoot() {
  return path.join(app.getPath('userData'), 'community-tmp')
}

export function sweepCommunityTmp() {
  try {
    fs.rmSync(tmpRoot(), { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

// onProgress({ message, phase, fraction, sounds }) fires once compression
// starts, after each sound is encoded, and once packed. `fraction` is the overall 0..1 bar (see
// uploadReport.js); `sounds` is [{ name, freesound, beforeBytes, afterBytes,
// durationSeconds, cuttable, cut }] with afterBytes null until that sound is
// done. cutSounds: indexes into that list the user asked to cut to 15 s.
// Returns { ok, buffer, manifest, sounds, soundCount, uploadedAudioCount, freesoundCount }
// or { ok: false, error, sounds? }. A too-large preset still encodes every
// sound first, so the error can name the heaviest ones.
export async function buildCommunityBundle(presetId, { onProgress, cutSounds = [] } = {}) {
  const bundle = buildPortableBundle(presetId, { skipFreesoundAudio: true })
  if (!bundle) return { ok: false, error: 'Preset not found.' }
  const { manifest, files } = bundle
  if (manifest.sounds.length === 0) return { ok: false, error: 'This preset has no sounds to share.' }

  const missing = manifest.sounds.filter((s) => !s.bundleName && s.source?.type !== 'freesound')
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Some sounds' audio files are missing: ${missing.map((s) => s.name).join(', ')}. Fix or remove them first.`
    }
  }

  const cutSet = new Set(Array.isArray(cutSounds) ? cutSounds : [])
  const hasFile = new Set(files.map((f) => f.soundIndex))
  const effective = manifest.sounds.map((s) => applySoundOverride(s.settings ?? {}, s.overrides))
  const sounds = manifest.sounds.map((s, i) => {
    const cuttable = hasFile.has(i) && canCut(effective[i], s.durationSeconds)
    return {
      name: s.name,
      freesound: s.source?.type === 'freesound',
      beforeBytes: null,
      afterBytes: null,
      durationSeconds: s.durationSeconds ?? null,
      loopSeconds: loopSeconds(effective[i], s.durationSeconds),
      cuttable,
      cut: cuttable && cutSet.has(i)
    }
  })
  const sourceSizes = files.map((f) => {
    let size = 0
    try {
      size = fs.statSync(f.sourcePath).size
    } catch {
      // unreadable: ffmpeg reports it below
    }
    sounds[f.soundIndex].beforeBytes = size
    return size
  })
  const report = (message, phase, fraction) =>
    onProgress?.({ message, phase, fraction, sounds: sounds.map((s) => ({ ...s })) })

  const workDir = path.join(tmpRoot(), crypto.randomUUID())
  fs.mkdirSync(workDir, { recursive: true })
  try {
    // Several sounds compress at once (one ffmpeg each); `packed` keeps the
    // original order so the bundle is the same either way.
    const packed = new Array(files.length)
    const done = new Set()
    let running = 0
    report(`Compressing ${files.length} sound${files.length === 1 ? '' : 's'}…`, 'compress', compressFraction(sourceSizes, done))
    await mapPool(files, encodeConcurrency(), async (f, i) => {
      const sound = manifest.sounds[f.soundIndex]
      const outName = `${path.basename(f.zipName, path.extname(f.zipName))}.opus`
      const outPath = path.join(workDir, `${i}.opus`)
      const win = sounds[f.soundIndex].cut ? cutWindow(effective[f.soundIndex], sound.durationSeconds) : null
      const range = win ? ['-ss', win.start.toFixed(3), '-t', String(CUT_SECONDS)] : []
      await runFfmpegToFile(['-y', ...range, '-i', f.sourcePath, '-vn', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', OPUS_BITRATE, outPath])
      if (win) {
        const ownLoop = (bag) => ({ loopStart: bag?.loopStart, loopEnd: bag?.loopEnd })
        const baseLoop = ownLoop(sound.settings)
        sound.settings = shiftForCut(sound.settings, baseLoop, sound.durationSeconds, win)
        // An override without its own trim inherits the baseline's.
        sound.overrides = shiftForCut(sound.overrides, { ...baseLoop, ...stripUndefined(ownLoop(sound.overrides)) }, sound.durationSeconds, win)
        sound.durationSeconds = CUT_SECONDS
        sound.fileSizeBytes = null
      }
      const data = fs.readFileSync(outPath)
      running += data.length
      sounds[f.soundIndex].afterBytes = data.length
      sound.bundleName = outName
      packed[i] = { zipName: `audio/${outName}`, data }
      done.add(i)
      report(`Compressed ${done.size} of ${files.length} sounds…`, 'compress', compressFraction(sourceSizes, done))
    })
    if (running > MAX_UPLOAD_BYTES) {
      return { ok: false, error: tooLargeMessage(sounds, running, MAX_UPLOAD_BYTES), sounds }
    }
    report('Packing preset…', 'pack', compressFraction(sourceSizes, done))

    const { buffer } = packPortableBundle({ manifest, files: packed })
    return {
      ok: true,
      buffer,
      manifest,
      sounds,
      soundCount: manifest.sounds.length,
      uploadedAudioCount: packed.length,
      freesoundCount: manifest.sounds.length - packed.length
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}
