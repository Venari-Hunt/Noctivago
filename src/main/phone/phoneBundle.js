import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildPortableBundle, writePortableBundle } from '../presetPortable.js'
import { effectiveCrossfadeSeconds } from '../library.js'
import { renderClipToPath, applyReverbPass, readWavDuration, probeDurationSeconds } from '../ffmpeg/loopClip.js'
import { runFfmpegToFile } from '../ffmpeg/runFfmpeg.js'
import { mapPool } from '../ffmpeg/mapPool.js'
import { encodeConcurrency, encodeOpus } from '../community/bundle.js'
import { CUT_SECONDS, cutWindow, shiftForCut } from '../community/cutClip.js'
import { applySoundOverride } from '../../shared/constants.js'
import {
  PHONE_BUNDLE_VERSION,
  busReverbs,
  withoutReverb,
  needsCut,
  loopWrapPlan,
  phoneSettings,
  memoryWarning,
  decodedBytes
} from './phoneBundleCore.js'

// "Export for phone" (docs/mobile.md, phase 1): writes a normal .ncvpreset
// whose audio/ holds each sound's baked clip as Opus, so the phone app only
// mixes. Freesound sounds ship their audio too (the phone has no API key).
// The manifest's `phone` field marks it; the sounds' settings are rewritten
// to "loop the whole clip, nothing else to apply" (phoneBundleCore.js), so
// the file also imports on the desktop and sounds the same.

const CLIP_RATE = 44100 // loopClip.js renders every clip at this rate

function tmpRoot() {
  return path.join(app.getPath('userData'), 'phone-export-tmp')
}

// Bus reverb on a loop clip, wrapped around the loop so it stays seamless.
async function wrapReverbOnLoop(clipPath, outPath, { sizeMs, mix }, work) {
  const clipSeconds = readWavDuration(clipPath)
  const { copies, keepFromSeconds } = loopWrapPlan(clipSeconds, sizeMs / 1000)
  const repeated = work('repeat.wav')
  const reverbed = work('reverbed.wav')
  await runFfmpegToFile(['-y', '-stream_loop', String(copies - 1), '-i', clipPath, '-c:a', 'pcm_s16le', '-ar', String(CLIP_RATE), repeated])
  await applyReverbPass(repeated, reverbed, sizeMs, mix)
  const start = Math.round(keepFromSeconds * CLIP_RATE)
  const end = start + Math.round(clipSeconds * CLIP_RATE)
  await runFfmpegToFile(['-y', '-i', reverbed, '-af', `atrim=start_sample=${start}:end_sample=${end},asetpts=N/SR/TB`, '-c:a', 'pcm_s16le', outPath])
}

// Bus reverb on a one-shot (Random Interval / Scheduled): its tail is appended.
async function appendReverbTail(clipPath, outPath, { sizeMs, mix }, work) {
  const padded = work('padded.wav')
  await runFfmpegToFile(['-y', '-i', clipPath, '-af', `apad=pad_dur=${(sizeMs / 1000).toFixed(3)}`, '-c:a', 'pcm_s16le', '-ar', String(CLIP_RATE), padded])
  await applyReverbPass(padded, outPath, sizeMs, mix)
}

// Bakes one sound to a WAV the way the Mixer plays it, plus its bus reverbs.
// Returns { wavPath, settings, cut }.
async function bakeSound({ sound, sourcePath, reverbs, workDir }) {
  let n = 0
  const work = (name) => path.join(workDir, `${n++}-${name}`)
  let effective = applySoundOverride(sound.settings ?? {}, sound.overrides)
  const durationSeconds = sound.durationSeconds ?? (await probeDurationSeconds(sourcePath))
  let inputPath = sourcePath
  let cut = false
  if (needsCut(effective, durationSeconds)) {
    const win = cutWindow(effective, durationSeconds)
    inputPath = work('cut.wav')
    await runFfmpegToFile(['-y', '-ss', win.start.toFixed(3), '-t', String(CUT_SECONDS), '-i', sourcePath, '-vn', '-c:a', 'pcm_s16le', inputPath])
    effective = shiftForCut({ ...effective, loopStart: effective.loopStart ?? 0, loopEnd: effective.loopEnd ?? durationSeconds }, effective, durationSeconds, win)
    cut = true
  }

  let clipPath = work('clip.wav')
  const result = await renderClipToPath({
    inputPath,
    loopStart: effective.loopStart ?? 0,
    loopEnd: effective.loopEnd ?? durationSeconds,
    filters: effective.filters ?? null,
    crossfadeSeconds: effectiveCrossfadeSeconds(effective),
    speedPitch: effective.speedPitch ?? null,
    outputPath: clipPath
  })
  if (!result.ok) throw new Error(`${sound.name}: ${result.error}`)

  const isLoop = (effective.playMode ?? 'loop') === 'loop'
  for (const reverb of reverbs) {
    const next = work('bus.wav')
    await (isLoop ? wrapReverbOnLoop : appendReverbTail)(clipPath, next, reverb, work)
    clipPath = next
  }
  return { wavPath: clipPath, effective, cut }
}

// onProgress({ type: 'step', label, fraction }) - the Export tab's own shape.
// Returns { ok, path, soundCount, totalBytes, decodedMB, warnings } or
// { ok: false, error }.
export async function exportForPhone(presetId, outputPath, { onProgress } = {}) {
  const bundle = buildPortableBundle(presetId)
  if (!bundle) return { ok: false, error: 'Preset not found.' }
  const { manifest, files } = bundle
  const missing = manifest.sounds.filter((s) => !s.bundleName)
  if (manifest.sounds.length === 0) return { ok: false, error: 'This preset has no sounds.' }
  if (missing.length > 0) {
    return { ok: false, error: `Some sounds' audio files are missing: ${missing.map((s) => s.name).join(', ')}. Fix or remove them first.` }
  }

  const groupOf = new Map()
  for (const g of manifest.groups) for (const i of g.soundIndexes) groupOf.set(i, g)
  const warnings = []
  const step = (label, fraction) => onProgress?.({ type: 'step', label, fraction })

  const workRoot = path.join(tmpRoot(), crypto.randomUUID())
  fs.mkdirSync(workRoot, { recursive: true })
  try {
    const packed = new Array(files.length)
    let done = 0
    step(`Baking ${files.length} sound${files.length === 1 ? '' : 's'} for the phone…`, 0)
    await mapPool(files, encodeConcurrency(), async (f, i) => {
      const sound = manifest.sounds[f.soundIndex]
      const workDir = path.join(workRoot, String(i))
      fs.mkdirSync(workDir)
      const reverbs = busReverbs(groupOf.get(f.soundIndex)?.filters, manifest.wholeMix)
      const { wavPath, effective, cut } = await bakeSound({ sound, sourcePath: f.sourcePath, reverbs, workDir })
      if (cut) warnings.push(`"${sound.name}" is a loop longer than 10 minutes, so the phone gets its middle ${CUT_SECONDS} s.`)
      const clipSeconds = readWavDuration(wavPath)
      const opusPath = path.join(workDir, 'clip.opus')
      await encodeOpus(wavPath, opusPath)
      const outName = `${path.basename(f.zipName, path.extname(f.zipName))}.opus`
      sound.bundleName = outName
      sound.settings = phoneSettings(effective, clipSeconds)
      sound.overrides = null
      sound.durationSeconds = clipSeconds
      sound.fileSizeBytes = fs.statSync(opusPath).size
      packed[i] = { zipName: `audio/${outName}`, sourcePath: opusPath }
      done += 1
      step(`Baked "${sound.name}" (${done} of ${files.length})`, done / files.length)
    })

    manifest.groups = manifest.groups.map((g) => ({ ...g, filters: withoutReverb(g.filters) }))
    manifest.wholeMix = withoutReverb(manifest.wholeMix)
    manifest.phone = { version: PHONE_BUNDLE_VERSION }

    const totalSeconds = manifest.sounds.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
    const memory = memoryWarning(totalSeconds)
    if (memory) warnings.push(memory)

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    const { soundCount, totalBytes } = writePortableBundle({ manifest, files: packed }, outputPath)
    step('Saved the phone preset', 1)
    return {
      ok: true,
      path: outputPath,
      soundCount,
      totalBytes,
      decodedMB: Math.round(decodedBytes(totalSeconds) / (1024 * 1024)),
      warnings
    }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true })
  }
}
