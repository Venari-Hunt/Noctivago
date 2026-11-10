import { formatDuration } from '../../../util/time.js'
import { formatSize } from '../../../util/size.js'

export function formatMeta(entry) {
  const parts = []
  if (entry.durationSeconds != null) parts.push(formatDuration(entry.durationSeconds))
  if (entry.fileSizeBytes != null) parts.push(formatSize(entry.fileSizeBytes))
  const source = sourceLabel(entry)
  if (source) parts.push(source)
  return parts.join(' · ')
}

// Where a sound came from, when that is not just "a file you added".
export function sourceLabel(entry) {
  if (entry.compositeSource) return 'Composite'
  if (entry.source?.type === 'freesound') return 'Freesound'
  return ''
}

const num = (n) => String(Math.round(n * 10) / 10)

// The second half of a card's play-type line, as in the mock: "any gap",
// "20–120 s apart" for Random; "12:00, 00:00" or "every hour" for Scheduled.
// A loop has none.
export function playDetail(entry) {
  if (entry.playMode === 'scatter') {
    const s = entry.scatter ?? {}
    if (s.gapFullyRandom) return 'any gap'
    const min = Number(s.minGapSeconds)
    const max = Number(s.maxGapSeconds)
    if (!Number.isFinite(min) || !Number.isFinite(max)) return ''
    return min === max ? `${num(min)} s apart` : `${num(min)}–${num(max)} s apart`
  }
  if (entry.playMode === 'scheduled') {
    const sch = entry.schedule ?? {}
    if (sch.type === 'interval') {
      const m = Number(sch.intervalMinutes)
      if (!Number.isFinite(m) || m <= 0) return ''
      return m === 60 ? 'every hour' : m % 60 === 0 ? `every ${m / 60} h` : `every ${num(m)} min`
    }
    const times = [...(sch.times ?? [])].filter(Boolean)
    if (times.length === 0) return ''
    return times.length > 2 ? `${times.slice(0, 2).join(', ')} +${times.length - 2}` : times.join(', ')
  }
  return ''
}

// Requested directly: a name truncated by window width should marquee-scroll
// on hover, "mildly fast, a little faster for really long names." Speed
// scales up mildly with how much text needs to scroll, capped so it never
// gets uncomfortably fast. The duration covers the round trip plus a little
// pause budget that the keyframes' held start/end percentages use (main.css).
const MARQUEE_BASE_PX_PER_SEC = 45
const MARQUEE_SPEED_SCALE = 0.06
const MARQUEE_MAX_PX_PER_SEC = 140

export function marqueeDurationSeconds(overflowPx) {
  const pxPerSec = Math.min(MARQUEE_MAX_PX_PER_SEC, MARQUEE_BASE_PX_PER_SEC + overflowPx * MARQUEE_SPEED_SCALE)
  return (overflowPx / pxPerSec) * 2 + 0.6
}

// Returns the existing tag's stored casing on a case-insensitive match, so
// "rain" becomes "Rain" instead of adding a silently-duplicate near-tag.
export function normalizeTagCasing(typed, allTags) {
  const match = allTags.find((t) => t.toLowerCase() === typed.toLowerCase())
  return match ?? typed
}

// Autocomplete only ever looks at the last comma-segment being typed;
// earlier segments are left alone.
export function matchingTags(inputValue, allTags, currentTags) {
  const parts = inputValue.split(',')
  const query = parts[parts.length - 1].trim().toLowerCase()
  if (!query) return []
  return allTags.filter((t) => t.toLowerCase().includes(query) && !currentTags.includes(t))
}

// Replaces just the last segment with the picked tag and arms the input for
// the next one.
export function applyTagSuggestion(inputValue, tag) {
  const parts = inputValue.split(',')
  parts[parts.length - 1] = ` ${tag}`
  return parts.map((p, i) => (i === 0 ? p.trim() : p)).join(',') + ', '
}

// null means nothing was typed, so the edit is abandoned.
export function mergeTypedTags(inputValue, currentTags, allTags) {
  const typed = inputValue
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => normalizeTagCasing(t, allTags))
  if (typed.length === 0) return null
  return [...new Set([...currentTags, ...typed])]
}

// A stable, distinct-per-group badge color, keyed on the group's id (not its
// name, so a rename doesn't shift the color).
//
// FNV-1a, not a plain polynomial rolling hash: the naive version put two ids
// differing by one trailing character ~2deg apart in hue.
//
// v0.1.241: hashing straight to `% 360` was still wrong in practice. A good
// hash spreads hues uniformly at random, which does nothing to stop two
// groups of the same preset landing a few degrees apart - the owner's "Rain
// Inside" drew 105/89/102, three greens. Fixed by hashing into a slot of a
// fixed, widely-spaced palette and walking collisions to the next free slot
// within the preset (assignGroupColorSlots).
// Eight hues 45deg apart. A 12-entry palette was measured against the
// owner's presets and still drew two greens 20deg apart. Past eight groups
// the hues repeat at a darker lightness (GROUP_BADGE_TIERS).
const GROUP_BADGE_HUES = [265, 310, 355, 40, 85, 130, 175, 220]
const GROUP_BADGE_TIERS = [68, 52]
const GROUP_BADGE_SLOTS = GROUP_BADGE_HUES.length * GROUP_BADGE_TIERS.length

function hashHue(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// The hash only ever picks a hue; a taken hue walks to the next free one,
// and the darker tier opens only once all eight hues are used. Letting the
// hash pick a tier directly gave two "Rain Inside" groups the same pink at
// two lightnesses. Order-dependent only when two groups actually collide,
// so an untouched preset keeps the same colors run to run.
export function assignGroupColorSlots(groups) {
  const slots = new Map()
  const taken = new Set()
  let tier = 0
  for (const group of groups ?? []) {
    if (!group?.id) continue
    if (taken.size === GROUP_BADGE_HUES.length) {
      taken.clear()
      tier = (tier + 1) % GROUP_BADGE_TIERS.length
    }
    let hue = hashHue(group.id) % GROUP_BADGE_HUES.length
    while (taken.has(hue)) hue = (hue + 1) % GROUP_BADGE_HUES.length
    taken.add(hue)
    slots.set(group.id, tier * GROUP_BADGE_HUES.length + hue)
  }
  return slots
}

export function groupBadgeColors(groupId, colorSlot) {
  const slot = Number.isInteger(colorSlot) ? colorSlot : hashHue(groupId) % GROUP_BADGE_SLOTS
  const hue = GROUP_BADGE_HUES[slot % GROUP_BADGE_HUES.length]
  const light = GROUP_BADGE_TIERS[Math.floor(slot / GROUP_BADGE_HUES.length) % GROUP_BADGE_TIERS.length]
  return {
    background: `hsla(${hue}, 70%, ${light}%, 0.22)`,
    borderColor: `hsla(${hue}, 70%, ${light}%, 0.55)`,
    color: `hsl(${hue}, 85%, ${light + 8}%)`
  }
}

// ---- Knob gestures (Desktop 2.0 step 3) ----
// Positions are 0..1 on shared/volumeScale.js's curve; never a second scale.

// A wheel is a "side-scroll" when it is mostly horizontal, or when Shift
// turns a vertical wheel sideways. Plain vertical scrolling returns 0 so the
// list still scrolls. Lines count as 40 px, like the mock.
export function sideScrollDelta({ deltaX = 0, deltaY = 0, deltaMode = 0, shiftKey = false }) {
  const unit = deltaMode === 1 ? 40 : 1
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX * unit
  return shiftKey ? deltaY * unit : 0
}

// 30 px of side-scroll is one percent of the knob's travel.
export const WHEEL_PX_PER_PERCENT = 30
// A drag of 160 px sweeps the whole arc. A felt value: the owner tunes it.
export const DRAG_PX_PER_SWEEP = 160
// Past this many pixels a press is a drag, not a click.
export const DRAG_THRESHOLD_PX = 3

export function clampPosition(pos) {
  return Math.min(1, Math.max(0, pos))
}

export function wheelPosition(startPos, delta) {
  return clampPosition(startPos + delta / WHEEL_PX_PER_PERCENT / 100)
}

export function dragPosition(startPos, dx) {
  return clampPosition(startPos + dx / DRAG_PX_PER_SWEEP)
}
