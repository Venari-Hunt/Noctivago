import crypto from 'node:crypto'
import { OVERRIDABLE_SOUND_KEYS } from '../shared/constants.js'

// Pure helpers for presetPortable.js, kept free of Electron/electron-store
// imports so test/presetPortableCore.test.js can run them under plain node.

export function isFreesoundSource(source) {
  if (!source || source.type !== 'freesound') return false
  const id = Number(source.freesoundId)
  return Number.isInteger(id) && id > 0
}

export function pickOverridable(settings) {
  const out = {}
  for (const key of OVERRIDABLE_SOUND_KEYS) {
    if (settings?.[key] !== undefined) out[key] = settings[key]
  }
  return out
}

// Portable groups name members by index into the manifest's sounds[]; a
// local group needs sound ids and its own id. A sound can only be in one
// group, so a later group loses a sound an earlier one already claimed.
// Groups left with no members are dropped.
export function remapGroups(groups, soundIdByIndex) {
  if (!Array.isArray(groups)) return []
  const claimed = new Set()
  const out = []
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue
    const soundIds = []
    for (const i of Array.isArray(g.soundIndexes) ? g.soundIndexes : []) {
      const id = soundIdByIndex.get(i)
      if (id && !claimed.has(id)) {
        claimed.add(id)
        soundIds.push(id)
      }
    }
    if (soundIds.length === 0) continue
    out.push({
      id: crypto.randomUUID(),
      name: String(g.name || 'Group').slice(0, 80),
      soundIds,
      filters: g.filters ?? null
    })
  }
  return out
}
