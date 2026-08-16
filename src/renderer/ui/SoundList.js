import { createSoundRow } from './SoundRow.js'

export const SORT_MODES = [
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'date-added-desc', label: 'Recently added' },
  { value: 'date-added-asc', label: 'Oldest added' },
  { value: 'date-created-desc', label: 'Recently created' },
  { value: 'date-created-asc', label: 'Oldest created' },
  { value: 'custom', label: 'Custom order' }
]

export const GROUP_MODES = [
  { value: 'none', label: 'No grouping' },
  { value: 'alphabetical', label: 'Group: Alphabetical' },
  { value: 'date-added', label: 'Group: Date added' },
  { value: 'date-created', label: 'Group: Date created' },
  { value: 'tags', label: 'Group: Tags' }
]

function compareBySortMode(a, b, sortMode) {
  switch (sortMode) {
    case 'name-desc':
      return b.name.localeCompare(a.name)
    case 'date-added-desc':
      return (b.dateAdded ?? 0) - (a.dateAdded ?? 0)
    case 'date-added-asc':
      return (a.dateAdded ?? 0) - (b.dateAdded ?? 0)
    case 'date-created-desc':
      return (b.dateCreated ?? 0) - (a.dateCreated ?? 0)
    case 'date-created-asc':
      return (a.dateCreated ?? 0) - (b.dateCreated ?? 0)
    case 'custom':
      return (a.sortIndex ?? 0) - (b.sortIndex ?? 0)
    case 'name-asc':
    default:
      return a.name.localeCompare(b.name)
  }
}

// Exported so the Mixer's drag-and-drop reorder handler can compute a new
// full-library order using the exact same ordering the list is currently
// displaying, rather than re-deriving it separately and risking drift.
export function sortForDisplay(entries, sortMode) {
  return [...entries].sort((a, b) => compareBySortMode(a, b, sortMode))
}

function alphabeticalGroupKey(entry) {
  const ch = entry.name.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(ch) ? ch : '#'
}

function formatDateGroupLabel(ms) {
  if (ms == null) return 'Unknown date'
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Buckets entries into ordered {label, entries} groups. Each entry appears
// in exactly one group for alphabetical/date grouping, but can appear in
// *multiple* groups for tag grouping (one per tag it has) - matching how a
// multi-value property groups in a file explorer, rather than picking just
// one tag arbitrarily. Groups themselves are ordered independently of
// sortMode (alphabetically, or newest-date-first); sortMode still governs
// the order of entries *within* each group.
function groupEntries(sortedEntries, groupMode) {
  if (groupMode === 'alphabetical') {
    const buckets = new Map()
    for (const entry of sortedEntries) {
      const key = alphabeticalGroupKey(entry)
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(entry)
    }
    return [...buckets.keys()]
      .sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
      .map((key) => ({ label: key, entries: buckets.get(key) }))
  }

  if (groupMode === 'date-added' || groupMode === 'date-created') {
    const field = groupMode === 'date-added' ? 'dateAdded' : 'dateCreated'
    const buckets = new Map()
    for (const entry of sortedEntries) {
      const ms = entry[field] ?? null
      const label = formatDateGroupLabel(ms)
      if (!buckets.has(label)) buckets.set(label, { ms, entries: [] })
      buckets.get(label).entries.push(entry)
    }
    return [...buckets.entries()]
      .sort(([, a], [, b]) => (b.ms ?? 0) - (a.ms ?? 0))
      .map(([label, { entries }]) => ({ label, entries }))
  }

  if (groupMode === 'tags') {
    const buckets = new Map()
    for (const entry of sortedEntries) {
      const tags = entry.tags?.length ? entry.tags : ['Untagged']
      for (const tag of tags) {
        if (!buckets.has(tag)) buckets.set(tag, [])
        buckets.get(tag).push(entry)
      }
    }
    return [...buckets.keys()]
      .sort((a, b) => (a === 'Untagged' ? 1 : b === 'Untagged' ? -1 : a.localeCompare(b)))
      .map((key) => ({ label: key, entries: buckets.get(key) }))
  }

  return [{ label: null, entries: sortedEntries }]
}

function buildRow(entry, rowState, draggable, callbacks) {
  const row = createSoundRow(entry, rowState, callbacks)
  if (!draggable) return row

  row.draggable = true
  row.classList.add('sound-row-draggable')
  row.addEventListener('dragstart', (evt) => {
    evt.dataTransfer.setData('text/plain', entry.id)
    evt.dataTransfer.effectAllowed = 'move'
    row.classList.add('dragging')
  })
  row.addEventListener('dragend', () => row.classList.remove('dragging'))
  row.addEventListener('dragover', (evt) => {
    evt.preventDefault()
    evt.dataTransfer.dropEffect = 'move'
  })
  row.addEventListener('drop', (evt) => {
    evt.preventDefault()
    const draggedId = evt.dataTransfer.getData('text/plain')
    if (draggedId && draggedId !== entry.id) callbacks.onReorderDrop(draggedId, entry.id)
  })
  return row
}

export function renderSoundList(listEl, emptyStateEl, entries, playbackState, viewState, callbacks) {
  listEl.innerHTML = ''

  if (entries.length === 0) {
    emptyStateEl.classList.remove('hidden')
    listEl.classList.add('hidden')
    return
  }

  emptyStateEl.classList.add('hidden')
  listEl.classList.remove('hidden')

  const sorted = sortForDisplay(entries, viewState.sortMode)
  // Disabled while grouped: a tag-grouped entry can appear in more than one
  // section (see groupEntries), which makes "which row did you actually
  // drag" ambiguous - simpler to require "No grouping" to reorder, matching
  // how most file explorers don't support a fully custom order combined
  // with grouping either.
  const draggable = viewState.sortMode === 'custom' && viewState.groupMode === 'none'

  function appendRow(entry) {
    const included = playbackState.included.has(entry.id)
    const loading = playbackState.loading.has(entry.id)
    const error = playbackState.errors.get(entry.id) ?? null
    const volume = playbackState.volumes.get(entry.id) ?? 0.7
    listEl.appendChild(buildRow(entry, { included, loading, error, volume }, draggable, callbacks))
  }

  if (viewState.groupMode === 'none') {
    for (const entry of sorted) appendRow(entry)
    return
  }

  for (const group of groupEntries(sorted, viewState.groupMode)) {
    const header = document.createElement('li')
    header.className = 'sound-group-header'
    header.textContent = group.label
    listEl.appendChild(header)
    for (const entry of group.entries) appendRow(entry)
  }
}
