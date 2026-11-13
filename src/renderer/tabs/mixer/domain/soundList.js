import { assignGroupColorSlots } from './soundRow.js'
import { DEFAULT_VOLUME } from '../../../../shared/volumeScale.js'

export const SORT_MODES = [
  { value: 'name-asc', label: 'Name (A-Z)', icon: 'name' },
  { value: 'name-desc', label: 'Name (Z-A)', icon: 'name' },
  { value: 'date-added-desc', label: 'Recently added', icon: 'clock' },
  { value: 'date-added-asc', label: 'Oldest added', icon: 'clock' },
  { value: 'date-created-desc', label: 'Recently created', icon: 'clock' },
  { value: 'date-created-asc', label: 'Oldest created', icon: 'clock' },
  { value: 'custom', label: 'Custom order', icon: 'sort' }
]

export const GROUP_MODES = [
  { value: 'none', label: 'No grouping', icon: 'none' },
  { value: 'alphabetical', label: 'Group: Alphabetical', icon: 'name' },
  { value: 'date-added', label: 'Group: Date added', icon: 'clock' },
  { value: 'date-created', label: 'Group: Date created', icon: 'clock' },
  { value: 'tags', label: 'Group: Tags', icon: 'filter' },
  { value: 'sound-group', label: 'Group: Sound Group', icon: 'folder' }
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

// One row = everything its card shows. One pass over the preset's whole group
// list, so the badge colors are picked knowing about each other - a per-row
// decision can't tell that two groups came out the same color.
function rowBuilder(playbackState, viewState, leaving = null) {
  const groupColorSlots = assignGroupColorSlots(playbackState.groups)
  const selectMode = Boolean(viewState.selectMode)
  return function row(entry, sectionLabel) {
    const soundGroup = playbackState.groups?.find((g) => g.soundIds.includes(entry.id)) ?? null
    const included = playbackState.included.has(entry.id)
    return {
      key: `${sectionLabel ?? ''}/${entry.id}`,
      entry,
      state: {
        included,
        leaving: Boolean(leaving?.has(entry.id)) && !included,
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
  const row = rowBuilder(playbackState, viewState)
  const section = (label, list) => ({ label, count: label == null ? null : list.length, rows: list.map((entry) => row(entry, label)) })

  if (viewState.groupMode !== 'none') {
    const sections = groupEntries(sorted, viewState.groupMode, playbackState).map((g) => section(g.label, g.entries))
    return { sections, draggable }
  }
  if (!nowPlaying) return { sections: [section(null, sorted)], draggable }
  const sections = [
    // The mock's two groups: what is in the mix (audible ones first), then the rest.
    section('In this mix', [...nowPlaying.playing, ...nowPlaying.inMix]),
    section('Library', nowPlaying.rest)
  ].filter((s) => s.rows.length > 0)
  return { sections, draggable }
}

// The Mixer studio center (mock-noctivago-mixer-studio): only the sounds in
// the mix, plus the ones just taken out (`leaving`: drawn dimmed until the
// owner leaves the screen, so a card never jumps away under the cursor).
export const MIX_ARRANGES = [
  { value: 'all', label: 'All sounds' },
  { value: 'group', label: 'By group' },
  { value: 'type', label: 'By play type' }
]

export const MIX_SORTS = [
  { value: 'mix', label: 'Mix order', icon: 'sort' },
  { value: 'name', label: 'Name (A-Z)', icon: 'name' },
  { value: 'loudest', label: 'Loudest first', icon: 'speaker' }
]

const PLAY_TYPE_SECTIONS = [
  ['loop', 'Loop'],
  ['random', 'Random'],
  ['scheduled', 'Scheduled']
]

export function playTypeKey(entry) {
  if (entry.playMode === 'scatter') return 'random'
  if (entry.playMode === 'scheduled') return 'scheduled'
  return 'loop'
}

// Mix order = the order the sounds went into the mix (`order`, from the
// state.included Set); a leaving sound keeps the place it had.
function sortMix(entries, sort, playbackState, order) {
  const list = [...entries]
  if (sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'loudest') {
    const vol = (e) => playbackState.volumes.get(e.id) ?? DEFAULT_VOLUME
    return list.sort((a, b) => vol(b) - vol(a) || a.name.localeCompare(b.name))
  }
  const rank = new Map(order.map((id, i) => [id, i]))
  return list.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
}

// The line under the preset name: "5 sounds · 2 groups · 3 random" (random =
// every sound that does not loop, as the mock counts it).
export function mixMeta(entries, playbackState) {
  const inMix = entries.filter((e) => playbackState.included.has(e.id))
  const groups = new Set()
  for (const e of inMix) {
    const g = playbackState.groups?.find((x) => x.soundIds.includes(e.id))
    if (g) groups.add(g.id)
  }
  const shots = inMix.filter((e) => playTypeKey(e) !== 'loop').length
  return `${inMix.length} sound${inMix.length === 1 ? '' : 's'} · ${groups.size} group${groups.size === 1 ? '' : 's'} · ${shots} random`
}

// entries = the whole library. viewState = { arrange, sort, leaving (Set of
// ids), order (ids in mix order), selectMode, selectedIds }. Returns sections
// like buildSoundListSections; a group section carries its groupId.
export function buildMixSections(entries, playbackState, viewState) {
  const leaving = viewState.leaving ?? new Set()
  const shown = entries.filter((e) => playbackState.included.has(e.id) || leaving.has(e.id))
  if (shown.length === 0) return []
  const order = viewState.order ?? [...playbackState.included]
  const sorted = sortMix(shown, viewState.sort, playbackState, order)
  const row = rowBuilder(playbackState, viewState, leaving)
  const section = (label, list, extra = {}) => ({ label, count: list.length, rows: list.map((e) => row(e, label)), ...extra })

  if (viewState.arrange === 'group') {
    const buckets = new Map()
    for (const entry of sorted) {
      const g = playbackState.groups?.find((x) => x.soundIds.includes(entry.id)) ?? null
      const key = g?.id ?? ''
      if (!buckets.has(key)) buckets.set(key, { group: g, list: [] })
      buckets.get(key).list.push(entry)
    }
    return [...buckets.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '') - (kb === '') || (a.group?.name ?? '').localeCompare(b.group?.name ?? ''))
      .map(([key, { group, list }]) => section(group?.name ?? 'Not in a group', list, key ? { groupId: key } : {}))
  }
  if (viewState.arrange === 'type') {
    return PLAY_TYPE_SECTIONS.map(([key, label]) => section(label, sorted.filter((e) => playTypeKey(e) === key))).filter((s) => s.rows.length > 0)
  }
  return [section('In this mix', sorted)]
}
