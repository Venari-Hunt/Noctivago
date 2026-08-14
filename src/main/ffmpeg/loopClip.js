import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { runFfmpegToFile } from './runFfmpeg.js'

const pending = new Map()

function clipsDir() {
  return path.join(app.getPath('userData'), 'clips')
}

export function getLoopClipPath(id) {
  return path.join(clipsDir(), `${id}.wav`)
}

// Renders just [loopStart, loopEnd) of inputPath into its own small WAV file,
// so it can be fully decoded client-side for native, sample-accurate looping
// instead of streaming the (possibly huge) original with an approximate
// seek-back loop. Never throws — callers get {ok:false, error} instead, so a
// failed render can't block saving the loop points themselves.
export function renderLoopClip({ id, inputPath, loopStart, loopEnd }) {
  if (pending.has(id)) return pending.get(id)

  const promise = doRender({ id, inputPath, loopStart, loopEnd }).finally(() => pending.delete(id))
  pending.set(id, promise)
  return promise
}

async function doRender({ id, inputPath, loopStart, loopEnd }) {
  const outputPath = getLoopClipPath(id)
  const tmpPath = `${outputPath}.tmp`
  fs.mkdirSync(clipsDir(), { recursive: true })

  const duration = loopEnd - loopStart
  const args = [
    '-y',
    '-ss', loopStart.toFixed(3),
    '-i', inputPath,
    '-t', duration.toFixed(3),
    '-map', '0:a:0',
    '-vn',
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-f', 'wav',
    tmpPath
  ]

  try {
    await runFfmpegToFile(args)
    fs.renameSync(tmpPath, outputPath)
    return { ok: true }
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // best-effort cleanup
      }
    }
    console.error('renderLoopClip failed', id, err)
    return { ok: false, error: err.message }
  }
}

export function deleteLoopClip(id) {
  const outputPath = getLoopClipPath(id)
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
  const tmpPath = `${outputPath}.tmp`
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
}
