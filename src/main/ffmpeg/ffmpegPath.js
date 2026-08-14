import { app } from 'electron'
import ffmpegPathRaw from 'ffmpeg-static'

export function resolveFfmpegPath() {
  if (!ffmpegPathRaw) throw new Error('ffmpeg-static did not resolve a binary for this platform')
  return app.isPackaged ? ffmpegPathRaw.replace('app.asar', 'app.asar.unpacked') : ffmpegPathRaw
}
