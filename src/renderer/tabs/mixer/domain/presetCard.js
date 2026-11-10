import { gainToPosition } from '../../../../shared/volumeScale.js'

// What one preset card shows (Desktop 2.0 Presets rail and gallery): the
// "fingerprint" (one bar per sound, steady loops in grey first, then the
// random and scheduled sounds in amber, each group loudest first), a count
// line, the preset's three most common tags and the day it was made.
// Pure: `libraryById` is a Map of library entries, so this is testable.

const MAX_TAGS = 3
const BAR_MAX_PX = 64

function isEvent(entry) {
  return entry?.playMode === 'scatter' || entry?.playMode === 'scheduled'
}

export function presetCardData(preset, libraryById) {
  const items = preset.sounds ?? []
  const bars = []
  const tagCounts = new Map()
  let loops = 0
  let random = 0
  let scheduled = 0
  let missing = 0

  for (const item of items) {
    const entry = libraryById.get(item.soundId)
    if (!entry) {
      missing++
      continue
    }
    const event = isEvent(entry)
    if (entry.playMode === 'scatter') random++
    else if (entry.playMode === 'scheduled') scheduled++
    else loops++
    const pos = gainToPosition(item.volume ?? 1) * 100
    bars.push({ event, height: Math.min(BAR_MAX_PX, Math.max(4, Math.round(pos * 0.64))) })
    for (const tag of entry.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }

  bars.sort((a, b) => Number(a.event) - Number(b.event) || b.height - a.height)

  const parts = [
    [loops, 'loops'],
    [random, 'random'],
    [scheduled, 'scheduled'],
    [missing, 'missing']
  ]
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)

  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TAGS)
    .map(([tag]) => tag)

  return {
    id: preset.id,
    name: preset.name,
    count: items.length,
    countText: `${items.length} ${items.length === 1 ? 'sound' : 'sounds'}`,
    modeText: parts.join(' · '),
    tags,
    bars,
    createdText: createdText(preset.createdAt)
  }
}

export function createdText(iso) {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return 'Created ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
