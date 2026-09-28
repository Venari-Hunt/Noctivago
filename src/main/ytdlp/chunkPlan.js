// Byte math for ytdlp/chunkedDownload.js. No Electron, so the tests can
// load it directly.

export const CHUNK_BYTES = 1024 * 1024
// Container headers and bitrate wobble: fetch a bit more than the average
// bitrate says, plus a fixed margin.
const BYTES_SAFETY_FACTOR = 1.15
const BYTES_MARGIN = 512 * 1024

// info: yt-dlp's JSON for the chosen format. Returns how many bytes from the
// start cover `maxSeconds` (0 = whole file), or null when it can't tell.
export function bytesForSeconds(info, maxSeconds) {
  const size = info.filesize || info.filesize_approx || null
  if (!(maxSeconds > 0)) return size
  let perSecond = null
  if (size && info.duration > 0) perSecond = size / info.duration
  else if (info.abr > 0 || info.tbr > 0) perSecond = ((info.abr || info.tbr) * 1000) / 8
  if (!perSecond) return size
  const wanted = Math.ceil(perSecond * maxSeconds * BYTES_SAFETY_FACTOR) + BYTES_MARGIN
  return size ? Math.min(size, wanted) : wanted
}

// [{ start, end }] inclusive byte ranges covering 0..total-1.
export function planChunks(total, chunkBytes = CHUNK_BYTES) {
  const chunks = []
  for (let start = 0; start < total; start += chunkBytes) {
    chunks.push({ start, end: Math.min(total, start + chunkBytes) - 1 })
  }
  return chunks
}

// Only a plain HTTPS file can be range-fetched; HLS/DASH manifests can't.
export function isRangeFetchable(info) {
  return Boolean(info?.url) && (info.protocol === 'https' || info.protocol === 'http')
}
