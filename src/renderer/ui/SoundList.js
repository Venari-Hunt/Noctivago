import { createSoundRow } from './SoundRow.js'

export function sortEntries(entries, playbackState) {
  return [...entries].sort((a, b) => {
    const aIncluded = playbackState.included.has(a.id)
    const bIncluded = playbackState.included.has(b.id)
    if (aIncluded !== bIncluded) return aIncluded ? -1 : 1
    if (aIncluded && bIncluded) {
      const av = playbackState.volumes.get(a.id) ?? 0
      const bv = playbackState.volumes.get(b.id) ?? 0
      if (av !== bv) return bv - av
    }
    return a.name.localeCompare(b.name)
  })
}

export function renderSoundList(listEl, emptyStateEl, entries, playbackState, callbacks) {
  listEl.innerHTML = ''

  if (entries.length === 0) {
    emptyStateEl.classList.remove('hidden')
    listEl.classList.add('hidden')
    return
  }

  emptyStateEl.classList.add('hidden')
  listEl.classList.remove('hidden')

  for (const entry of sortEntries(entries, playbackState)) {
    const included = playbackState.included.has(entry.id)
    const loading = playbackState.loading.has(entry.id)
    const error = playbackState.errors.get(entry.id) ?? null
    const volume = playbackState.volumes.get(entry.id) ?? 0.7
    listEl.appendChild(createSoundRow(entry, { included, loading, error, volume }, callbacks))
  }
}
