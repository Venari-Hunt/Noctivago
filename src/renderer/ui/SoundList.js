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
  { value: 'tags', label: 'Group: Tags' },
  { value: 'sound-group', label: 'Group: Sound Group' }
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
function groupEntries(sortedEntries, groupMode, soundGroups) {
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

  if (groupMode === 'sound-group') {
    // One bucket per Sound Group (a sound belongs to at most one, per
    // AudioEngine.js's SoundGroupChain - unlike Tags above, no entry appears
    // twice), plus an "Ungrouped" bucket for everything else, sorted last -
    // same convention alphabetical/tags already use for their own catch-all.
    const buckets = new Map()
    for (const entry of sortedEntries) {
      const group = soundGroups?.find((g) => g.soundIds.includes(entry.id)) ?? null
      const key = group?.id ?? '__ungrouped'
      if (!buckets.has(key)) buckets.set(key, { label: group?.name ?? 'Ungrouped', entries: [] })
      buckets.get(key).entries.push(entry)
    }
    return [...buckets.entries()]
      .sort(([keyA, a], [keyB, b]) =>
        keyA === '__ungrouped' ? 1 : keyB === '__ungrouped' ? -1 : a.label.localeCompare(b.label)
      )
      .map(([, { label, entries }]) => ({ label, entries }))
  }

  return [{ label: null, entries: sortedEntries }]
}

function buildRow(entry, rowState, draggable, callbacks, allTags) {
  const row = createSoundRow(entry, rowState, callbacks, allTags)
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

// Splits into three ordered groups - Now Playing (actually audible),
// Current Mix (included but not currently playing, e.g. paused via the
// global toggle), Everything Else - restoring the old "what's actually
// making noise right now" ordering plus a requested middle tier for "what's
// checked into the mix but silent right now". `included` stays true through
// a global pause (see toggleIncluded's own comment), so it's the right
// signal for "in the mix" independent of whether audio is actually flowing.
// Framed as an automatic grouping rather than a manual sort/toggle so
// there's nothing to remember to turn on. Only kicks in with no explicit
// groupMode chosen (matches how drag-reorder similarly defers to an
// explicit group choice above) and only when at least one sound is playing
// or included - a fully idle mixer renders exactly as before. Each bucket's
// own order falls back to sortedEntries' existing order (already sorted by
// viewState.sortMode) rather than being reshuffled arbitrarily, since
// Array.prototype.sort is a stable sort; Now Playing additionally sorts
// loudest (highest per-sound volume) first.
function splitNowPlaying(sortedEntries, playbackState) {
  const playing = []
  const inMix = []
  const rest = []
  for (const entry of sortedEntries) {
    if (playbackState.playing.has(entry.id)) playing.push(entry)
    else if (playbackState.included.has(entry.id)) inMix.push(entry)
    else rest.push(entry)
  }
  if (playing.length === 0 && inMix.length === 0) return null
  playing.sort((a, b) => (playbackState.volumes.get(b.id) ?? 0.7) - (playbackState.volumes.get(a.id) ?? 0.7))
  return { playing, inMix, rest }
}

// allTags is every tag used anywhere in the *full* library (not just
// entries, which may already be search/tag-filtered down by the caller) -
// drives the "+ tag" input's autocomplete in SoundRow.js. Defaults to []
// for callers that don't have/need it, so this stays an additive parameter.
export function renderSoundList(listEl, emptyStateEl, entries, playbackState, viewState, callbacks, allTags = []) {
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
    const muted = playbackState.mutedSounds.has(entry.id)
    const soloed = playbackState.soloedSoundId === entry.id
    // Which Sound Group (if any) this sound belongs to, so SoundRow.js can
    // show it as a visible badge - previously the only way to see this was
    // to right-click the sound and check which group had a checkmark
    // (reported directly: "you don't have any way to know if an audio is in
    // a group unless you go ahead and right click it").
    const soundGroup = playbackState.groups?.find((g) => g.soundIds.includes(entry.id)) ?? null
    const groupName = soundGroup?.name ?? null
    const groupId = soundGroup?.id ?? null
    const selectMode = Boolean(viewState.selectMode)
    const selected = selectMode && Boolean(viewState.selectedIds?.has(entry.id))
    listEl.appendChild(buildRow(entry, { included, loading, error, volume, muted, soloed, groupName, groupId, selectMode, selected }, draggable, callbacks, allTags))
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
    if (nowPlaying.playing.length > 0) {
      appendHeader('Now Playing')
      for (const entry of nowPlaying.playing) appendRow(entry)
    }
    if (nowPlaying.inMix.length > 0) {
      appendHeader('Current Mix')
      for (const entry of nowPlaying.inMix) appendRow(entry)
    }
    if (nowPlaying.rest.length > 0) {
      appendHeader('Everything Else')
      for (const entry of nowPlaying.rest) appendRow(entry)
    }
    return
  }

  for (const group of groupEntries(sorted, viewState.groupMode, playbackState.groups)) {
    appendHeader(group.label)
    for (const entry of group.entries) appendRow(entry)
  }
}
