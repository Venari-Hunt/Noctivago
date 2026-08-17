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

// Floats currently-playing sounds to their own group at the top, loudest
// (highest per-sound volume) first - restores the old "what's actually
// making noise right now" ordering the owner wanted back, framed as an
// automatic group rather than a manual sort/toggle so there's nothing to
// remember to turn on. Only kicks in with no explicit groupMode chosen
// (matches how drag-reorder similarly defers to an explicit group choice
// above) and only when something's actually playing - an idle mixer renders
// exactly as before. Volume ties fall back to sortedEntries' own existing
// order (already sorted by viewState.sortMode) rather than being reshuffled
// arbitrarily, since Array.prototype.sort is a stable sort.
function splitNowPlaying(sortedEntries, playbackState) {
  const playing = []
  const rest = []
  for (const entry of sortedEntries) {
    if (playbackState.playing.has(entry.id)) playing.push(entry)
    else rest.push(entry)
  }
  if (playing.length === 0) return null
  playing.sort((a, b) => (playbackState.volumes.get(b.id) ?? 0.7) - (playbackState.volumes.get(a.id) ?? 0.7))
  return { playing, rest }
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
  const nowPlaying = viewState.groupMode === 'none' ? splitNowPlaying(sorted, playbackState) : null
  // Disabled while grouped (explicitly, or by the automatic Now Playing
  // split below): a row can end up in a different section than where it was
  // dragged from/to (a tag-grouped entry can appear in more than one
  // section, see groupEntries; a Now-Playing row could move to Everything
  // Else on the very next render if it stops playing), which makes "which
  // row did you actually drag" ambiguous - simpler to require a single flat
  // "No grouping, nothing playing" list to reorder, matching how most file
  // explorers don't support a fully custom order combined with grouping.
  const draggable = viewState.sortMode === 'custom' && viewState.groupMode === 'none' && !nowPlaying

  function appendRow(entry) {
    const included = playbackState.included.has(entry.id)
    const loading = playbackState.loading.has(entry.id)
    const error = playbackState.errors.get(entry.id) ?? null
    const volume = playbackState.volumes.get(entry.id) ?? 0.7
    listEl.appendChild(buildRow(entry, { included, loading, error, volume }, draggable, callbacks))
  }

  function appendHeader(label) {
    const header = document.createElement('li')
    header.className = 'sound-group-header'
    header.textContent = label
    listEl.appendChild(header)
  }

  if (viewState.groupMode === 'none') {
    if (!nowPlaying) {
      for (const entry of sorted) appendRow(entry)
      return
    }
    appendHeader('Now Playing')
    for (const entry of nowPlaying.playing) appendRow(entry)
    if (nowPlaying.rest.length > 0) {
      appendHeader('Everything Else')
      for (const entry of nowPlaying.rest) appendRow(entry)
    }
    return
  }

  for (const group of groupEntries(sorted, viewState.groupMode)) {
    appendHeader(group.label)
    for (const entry of group.entries) appendRow(entry)
  }
}
