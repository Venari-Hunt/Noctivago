import { formatDuration } from '../../../util/time.js'

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatMeta(entry) {
  const parts = []
  if (entry.durationSeconds != null) parts.push(formatDuration(entry.durationSeconds))
  if (entry.fileSizeBytes != null) parts.push(formatSize(entry.fileSizeBytes))
  return parts.join(' · ')
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
