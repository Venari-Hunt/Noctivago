import fs from 'node:fs'
import { runFfmpegToFile, runFfmpegPipe } from './runFfmpeg.js'

// Converts one WAV to FLAC and keeps it only if it is truly lossless and
// smaller. The check decodes both files to 64-bit float and compares MD5s:
// 8/16/24-bit PCM survives exactly, while a float or 32-bit WAV (which FLAC
// can't hold exactly) fails the check or the encode and is left as WAV.
// Resolves { ok: true, before, after } or { ok: false, reason }.
export async function compressToFlac(srcPath, dstPath) {
  const tmpPath = `${dstPath}.part`
  try {
    await runFfmpegToFile(['-y', '-v', 'error', '-i', srcPath, '-map', '0:a:0', '-map_metadata', '0', '-c:a', 'flac', '-f', 'flac', tmpPath])
    const [a, b] = await Promise.all([pcmMd5(srcPath), pcmMd5(tmpPath)])
    if (!a || a !== b) return { ok: false, reason: 'not lossless' }
    const before = fs.statSync(srcPath).size
    const after = fs.statSync(tmpPath).size
    if (after >= before) return { ok: false, reason: 'not smaller' }
    fs.renameSync(tmpPath, dstPath)
    return { ok: true, before, after }
  } catch (err) {
    return { ok: false, reason: err.message }
  } finally {
    fs.rmSync(tmpPath, { force: true })
  }
}

async function pcmMd5(filePath) {
  let out = ''
  await runFfmpegPipe(['-v', 'error', '-i', filePath, '-map', '0:a:0', '-c:a', 'pcm_f64le', '-f', 'md5', '-'], (chunk) => {
    out += chunk.toString()
  })
  return out.trim()
}
