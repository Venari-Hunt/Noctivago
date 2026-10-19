// Progress and size rules for a community upload. No Electron, no fs, so
// the tests can load it directly.

// Share of the overall bar each phase fills. Compression and the phone copy
// are local and usually the slow part; the upload is one request.
export const COMPRESS_SHARE = 0.5
export const PHONE_SHARE = 0.25

// Overall 0..1 while compressing: weighted by each file's original size, so
// one long sound moves the bar as much as it costs. `done` is how many files
// from the start are done, or a Set of finished indexes (sounds compress in
// parallel, so they finish out of order).
export function compressFraction(sizes, done) {
  const isDone = typeof done === 'number' ? (i) => i < done : (i) => done.has(i)
  const doneCount = sizes.filter((_, i) => isDone(i)).length
  const total = sizes.reduce((sum, s) => sum + s, 0)
  if (total <= 0) return sizes.length ? (doneCount / sizes.length) * COMPRESS_SHARE : COMPRESS_SHARE
  const doneBytes = sizes.reduce((sum, s, i) => sum + (isDone(i) ? s : 0), 0)
  return (doneBytes / total) * COMPRESS_SHARE
}

// Overall 0..1 while baking the phone copy: `done` of `total` sounds.
export function phoneFraction(done, total) {
  const part = total > 0 ? Math.min(1, done / total) : 1
  return COMPRESS_SHARE + part * PHONE_SHARE
}

export function uploadFraction(sentBytes, totalBytes) {
  const start = COMPRESS_SHARE + PHONE_SHARE
  const part = totalBytes > 0 ? Math.min(1, sentBytes / totalBytes) : 1
  return start + part * (1 - start)
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
    `Heaviest: ${names}. Cut them to 15 s, shorten or remove them, then try again.`
  )
}
