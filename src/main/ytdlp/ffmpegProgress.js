// Reads ffmpeg's own stderr progress clock. Electron-free, so it can be
// unit-tested directly (test/ffmpegProgress.test.js).
//
// Why this exists: `yt-dlp --download-sections` hands the actual transfer to
// ffmpeg, which prints its progress as `size= 1024kB time=00:01:06.62
// bitrate=125.9kbits/s speed=2x` rather than anything yt-dlp turns into a
// `[download] NN%` line. Those lines are carriage-return-separated in one
// stderr chunk, so the *last* match in a chunk is the current position.

const PROGRESS = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)(?:.*?speed=\s*([\d.]+)x)?/g

// Returns { percent, seconds, speed, etaSeconds, etaText } for the latest
// progress line in `text`, or null if the chunk has none.
export function parseFfmpegProgress(text, totalSeconds) {
  if (!(totalSeconds > 0)) return null
  let last = null
  for (const match of text.matchAll(PROGRESS)) last = match
  if (!last) return null

  const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
  if (!Number.isFinite(seconds)) return null
  const percent = Math.max(0, Math.min(100, (seconds / totalSeconds) * 100))
  const speed = Number(last[4])
  // ffmpeg reports speed as a multiple of real time, so the media still to
  // come divided by that multiple is the wall-clock wait. A speed of 0 (or a
  // line without one) means there's nothing to estimate from yet.
  const etaSeconds = speed > 0 ? Math.max(0, (totalSeconds - seconds) / speed) : null
  return { percent, seconds, speed: Number.isFinite(speed) ? speed : null, etaSeconds, etaText: formatEta(etaSeconds) }
}

export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null
  if (seconds < 45) return 'half a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes <= 1) return 'a minute'
  return `${minutes} minutes`
}
