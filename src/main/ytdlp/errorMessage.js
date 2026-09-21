// Turns yt-dlp's stderr tail into one sentence a person can act on.
// Electron-free (test/ytDlpErrorMessage.test.js).
//
// yt-dlp's real reason is always an `ERROR: [youtube] <id>: <reason>` line,
// but the tail around it is ffmpeg's muxing detail and multi-kilobyte signed
// googlevideo URLs. Surfacing the raw tail made every failure look the same
// in the UI, which is most of why importing from YouTube felt broken: a live
// stream, a deleted video and a sign-in wall all read alike.

const ERROR_LINE = /^ERROR:\s*(.*)$/
// `[youtube] dQw4w9WgXcQ: ` and friends - the extractor/id prefix adds
// nothing once the message is shown next to the result you clicked.
const EXTRACTOR_PREFIX = /^\[[^\]]+\]\s*[\w-]+:\s*/

// Reasons worth rewriting: yt-dlp's own wording assumes you know the tool.
const FRIENDLY = [
  [/live stream recording is not available/i, "That's a live stream, so there's no recording to import yet."],
  [/requested format is not available/i, 'That video has no audio track this app can download.'],
  [/members-only|join this channel/i, "That video is members-only, so it can't be downloaded."],
  [/confirm you(?:'|&#39;)?re not a bot|sign in to confirm/i, 'YouTube asked for a sign-in. Pick a browser under "Sign in as" in Browse Sounds\' settings and try again.'],
  [/video is unavailable|video is not available|private video|removed by the uploader/i, "YouTube won't serve that video (it may be private, removed or region-locked)."]
]

export function ytDlpErrorMessage(stderrTail, fallback = 'yt-dlp could not download that video.') {
  const lines = String(stderrTail ?? '').split(/\r?\n/)
  const errors = lines.map((line) => ERROR_LINE.exec(line.trim())).filter(Boolean)
  if (errors.length === 0) return fallback

  const raw = errors[errors.length - 1][1].replace(EXTRACTOR_PREFIX, '').trim()
  if (!raw) return fallback
  const friendly = FRIENDLY.find(([pattern]) => pattern.test(raw))
  if (friendly) return friendly[1]
  // Drop yt-dlp's own trailing advice to re-run it with a flag - there's no
  // command line to re-run it on from inside the app.
  return raw.replace(/\s*(Use --list-formats.*|Sign in if you've been granted access.*)$/i, '').trim() || fallback
}
