import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildPortableBundle, packPortableBundle } from '../presetPortable.js'
import { runFfmpegToFile } from '../ffmpeg/runFfmpeg.js'

// Builds the .ncvpreset a community upload sends. Two differences from a
// local "Export preset" file, both to keep uploads small:
//   - Freesound sounds carry no audio (the recipient re-downloads them by id).
//   - Every other sound is re-encoded to Opus at OPUS_BITRATE before packing.
//     Loop points, envelopes and schedules are in seconds, so a re-encode
//     leaves them valid.

// Must match community/src/validate.js's maxBundleBytes.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const OPUS_BITRATE = '96k'

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

// onProgress({ message, done, total }) fires once per sound encoded.
// Returns { ok, buffer, manifest, soundCount, uploadedAudioCount, freesoundCount } or { ok: false, error }.
export async function buildCommunityBundle(presetId, { onProgress } = {}) {
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

  const workDir = path.join(tmpRoot(), crypto.randomUUID())
  fs.mkdirSync(workDir, { recursive: true })
  try {
    const packed = []
    let running = 0
    for (const [i, f] of files.entries()) {
      const sound = manifest.sounds[f.soundIndex]
      onProgress?.({ message: `Compressing "${sound.name}"…`, done: i, total: files.length })
      const outName = `${path.basename(f.zipName, path.extname(f.zipName))}.opus`
      const outPath = path.join(workDir, `${i}.opus`)
      await runFfmpegToFile(['-y', '-i', f.sourcePath, '-vn', '-map', '0:a:0', '-c:a', 'libopus', '-b:a', OPUS_BITRATE, outPath])
      const data = fs.readFileSync(outPath)
      running += data.length
      if (running > MAX_UPLOAD_BYTES) {
        return {
          ok: false,
          error: `This preset is too large to share (over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB after compression). Try shorter sounds.`
        }
      }
      sound.bundleName = outName
      packed.push({ zipName: `audio/${outName}`, data })
    }
    onProgress?.({ message: 'Packing preset…', done: files.length, total: files.length })

    const { buffer } = packPortableBundle({ manifest, files: packed })
    return {
      ok: true,
      buffer,
      manifest,
      soundCount: manifest.sounds.length,
      uploadedAudioCount: packed.length,
      freesoundCount: manifest.sounds.length - packed.length
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}
