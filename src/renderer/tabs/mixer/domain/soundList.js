import { assignGroupColorSlots } from './soundRow.js'
import { DEFAULT_VOLUME } from '../../../core/volumeScale.js'

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
function groupEntries(sortedEntries, groupMode, playbackState) {
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
    // Ungrouped sounds in the mix go to a "Playing (ungrouped)" bucket on top
    // instead, so they aren't buried in the rest of the library. In the mix
    // rather than audible, so a global pause doesn't make the section vanish.
    const buckets = new Map()
    for (const entry of sortedEntries) {
      const group = playbackState.groups?.find((g) => g.soundIds.includes(entry.id)) ?? null
      const inMix = playbackState.playing.has(entry.id) || playbackState.included.has(entry.id)
      const key = group?.id ?? (inMix ? '__playing' : '__ungrouped')
      const label = group?.name ?? (inMix ? 'Playing (ungrouped)' : 'Ungrouped')
      if (!buckets.has(key)) buckets.set(key, { label, entries: [] })
      buckets.get(key).entries.push(entry)
    }
    const rank = (key) => (key === '__playing' ? -1 : key === '__ungrouped' ? 1 : 0)
    return [...buckets.entries()]
      .sort(([keyA, a], [keyB, b]) => rank(keyA) - rank(keyB) || a.label.localeCompare(b.label))
      .map(([, { label, entries }]) => ({ label, entries }))
  }

  return [{ label: null, entries: sortedEntries }]
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
  playing.sort((a, b) => (playbackState.volumes.get(b.id) ?? DEFAULT_VOLUME) - (playbackState.volumes.get(a.id) ?? DEFAULT_VOLUME))
  return { playing, inMix, rest }
}

// The list as sections of rows, each row carrying everything its card shows.
// A tag-grouped entry can appear in several sections, so row keys include
// the section.
export function buildSoundListSections(entries, playbackState, viewState) {
  const sorted = sortForDisplay(entries, viewState.sortMode)
  const nowPlaying = viewState.groupMode === 'none' ? splitNowPlaying(sorted, playbackState) : null
  // Disabled while grouped (explicitly, or by the automatic Now Playing
  // split): a row can end up in a different section than where it was
  // dragged from/to (a tag-grouped entry can appear in several sections; a
  // Now-Playing row moves to Everything Else once it stops), which makes
  // "which row did you actually drag" ambiguous.
  const draggable = viewState.sortMode === 'custom' && viewState.groupMode === 'none' && !nowPlaying
  // One pass over the preset's whole group list, so the badge colors are
  // picked knowing about each other - a per-row decision can't tell that two
  // groups came out the same color.
  const groupColorSlots = assignGroupColorSlots(playbackState.groups)
  const selectMode = Boolean(viewState.selectMode)

  function row(entry, sectionLabel) {
    const soundGroup = playbackState.groups?.find((g) => g.soundIds.includes(entry.id)) ?? null
    return {
      key: `${sectionLabel ?? ''}/${entry.id}`,
      entry,
      state: {
        included: playbackState.included.has(entry.id),
        loading: playbackState.loading.has(entry.id),
        error: playbackState.errors.get(entry.id) ?? null,
        volume: playbackState.volumes.get(entry.id) ?? DEFAULT_VOLUME,
        muted: playbackState.mutedSounds.has(entry.id),
        soloed: playbackState.soloedSoundId === entry.id,
        groupName: soundGroup?.name ?? null,
        groupId: soundGroup?.id ?? null,
        groupColorSlot: soundGroup ? (groupColorSlots.get(soundGroup.id) ?? null) : null,
        selectMode,
        selected: selectMode && Boolean(viewState.selectedIds?.has(entry.id))
      }
    }
  }
  const section = (label, list) => ({ label, rows: list.map((entry) => row(entry, label)) })

  if (viewState.groupMode !== 'none') {
    const sections = groupEntries(sorted, viewState.groupMode, playbackState).map((g) => section(g.label, g.entries))
    return { sections, draggable }
  }
  if (!nowPlaying) return { sections: [section(null, sorted)], draggable }
  const sections = [
    section('Now Playing', nowPlaying.playing),
    section('Current Mix', nowPlaying.inMix),
    section('Everything Else', nowPlaying.rest)
  ].filter((s) => s.rows.length > 0)
  return { sections, draggable }
}
