// Progress and size rules for a community upload. No Electron, no fs, so
// the tests can load it directly.

// Share of the overall bar each phase fills. Compression is local and
// usually the slow part; the upload is one request.
export const COMPRESS_SHARE = 0.7

// Overall 0..1 while compressing: weighted by each file's original size, so
// one long sound moves the bar as much as it costs.
export function compressFraction(sizes, doneCount) {
  const total = sizes.reduce((sum, s) => sum + s, 0)
  if (total <= 0) return sizes.length ? (doneCount / sizes.length) * COMPRESS_SHARE : COMPRESS_SHARE
  const done = sizes.slice(0, doneCount).reduce((sum, s) => sum + s, 0)
  return (done / total) * COMPRESS_SHARE
}

export function uploadFraction(sentBytes, totalBytes) {
  const part = totalBytes > 0 ? Math.min(1, sentBytes / totalBytes) : 1
  return COMPRESS_SHARE + part * (1 - COMPRESS_SHARE)
}

export function formatMB(bytes) {
  const mb = bytes / 1024 / 1024
  return mb < 0.1 ? '<0.1 MB' : `${mb.toFixed(1)} MB`
}

// sounds: [{ name, afterBytes }]. The heaviest first, up to `limit`, only
// counting ones that were actually uploaded.
export function heaviestSounds(sounds, limit = 3) {
  return sounds
    .filter((s) => Number.isFinite(s.afterBytes))
    .sort((a, b) => b.afterBytes - a.afterBytes)
    .slice(0, limit)
}

export function tooLargeMessage(sounds, totalBytes, maxBytes) {
  const heavy = heaviestSounds(sounds)
  const names = heavy.map((s) => `"${s.name}" (${formatMB(s.afterBytes)})`).join(', ')
  const limit = Math.round(maxBytes / 1024 / 1024)
  return (
    `This preset is ${formatMB(totalBytes)} after compression; the limit is ${limit} MB. ` +
    `Heaviest: ${names}. Shorten or remove those and try again.`
  )
}
