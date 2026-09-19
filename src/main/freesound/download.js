import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { runFfmpegToFile } from '../ffmpeg/runFfmpeg.js'
import { authorizedPreviewUrl } from './client.js'
import { STORED_AUDIO_EXT, STORED_AUDIO_ARGS } from '../ffmpeg/storedAudio.js'

// Same shape as library.js's own downloadDirectAudio (link-import) - the
// bundled ffmpeg's http/https client fetches the preview file directly and
// transcodes to a scratch wav, which then goes through the exact same
// addSound(keepCopy: true) path any other imported file does. Freesound
// previews are always short (seconds, at most a couple minutes), so unlike
// the link-import path this needs no length cap or percent-based progress -
// just a "downloading" status line.
const RW_TIMEOUT_MICROSECONDS = 30_000_000 // 30s

export async function downloadPreviewAudio(previewUrl) {
  const tmpDir = path.join(app.getPath('userData'), 'download-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const audioPath = path.join(tmpDir, `${crypto.randomUUID()}${STORED_AUDIO_EXT}`)
  const authedUrl = authorizedPreviewUrl(previewUrl)
  await runFfmpegToFile(['-y', '-rw_timeout', String(RW_TIMEOUT_MICROSECONDS), '-i', authedUrl, '-vn', ...STORED_AUDIO_ARGS, audioPath])
  return audioPath
}
