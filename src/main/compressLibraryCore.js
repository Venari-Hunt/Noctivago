// Rules for "Compress library sounds" (Settings → Library): WAV copies the
// app keeps in its own sounds folder become lossless FLAC. No Electron or
// file system here; library.js does the I/O.
//
// Why the swap waits for the next start: a playing sound streams its file
// through sound://<id> in byte ranges. Pointing that id at a different file
// mid-stream would hand the player FLAC bytes at WAV offsets. So the FLAC is
// written beside the WAV now, recorded as a pending swap, and the entries
// switch over at the next launch, before anything can play.

export function flacNameFor(storedFileName) {
  return storedFileName.replace(/\.wav$/i, '.flac')
}

function isWavCopy(sound) {
  return sound.storageMode === 'copied' && typeof sound.storedFileName === 'string' && /\.wav$/i.test(sound.storedFileName)
}

// Unique WAV files to convert. A duplicated sound shares its original's file,
// so files are listed once. Files already converted and waiting for the
// restart are left out, and so are files an earlier run had to leave as WAV
// (skipped) and any file whose FLAC name some other sound already uses.
export function compressionCandidates(sounds, pending = [], skipped = []) {
  const waiting = new Set([...pending.map((p) => p.from), ...skipped])
  const used = new Set(sounds.map((s) => s.storedFileName).filter(Boolean))
  const files = []
  for (const s of sounds) {
    if (!isWavCopy(s) || waiting.has(s.storedFileName) || files.includes(s.storedFileName)) continue
    if (used.has(flacNameFor(s.storedFileName))) continue
    files.push(s.storedFileName)
  }
  return files
}

// Startup: point every sound that used a converted WAV at its FLAC.
// Returns the new sound list and the files to delete: the old WAVs, or a
// FLAC whose sounds were all deleted before the restart. A swap whose FLAC
// is missing is dropped and the WAV stays in use.
export function applyFlacSwaps(sounds, pending, { exists, sizeOf }) {
  let next = sounds
  const deleteFiles = []
  for (const { from, to } of pending) {
    if (!exists(to)) continue
    const uses = (s) => s.storageMode === 'copied' && s.storedFileName === from
    if (!next.some(uses)) {
      deleteFiles.push(to)
      continue
    }
    const size = sizeOf(to)
    next = next.map((s) => (uses(s) ? { ...s, storedFileName: to, fileSizeBytes: size } : s))
    deleteFiles.push(from)
  }
  return { sounds: next, deleteFiles }
}
