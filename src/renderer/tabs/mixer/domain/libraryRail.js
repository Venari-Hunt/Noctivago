import { formatDuration } from '../../../util/time.js'

// The Mixer's library rail (approved mock mock-noctivago-mixer-studio): the
// whole library as one list, a row being the in-mix switch, with All / In mix
// / Groups chips and its own search. Rules only, no DOM.

export const RAIL_SCOPES = ['All', 'In mix', 'Groups']

const PLAY_LABEL = { loop: 'Loop', random: 'Random', scheduled: 'Scheduled' }

export function railPlayType(entry) {
  if (entry.playMode === 'scatter') return 'random'
  if (entry.playMode === 'scheduled') return 'scheduled'
  return 'loop'
}

// "1:24 · Loop · Rain" as in the mock: length, play type, Sound Group.
function soundMeta(entry, groupName) {
  const parts = []
  if (entry.durationSeconds != null) parts.push(formatDuration(entry.durationSeconds))
  parts.push(PLAY_LABEL[railPlayType(entry)])
  if (groupName) parts.push(groupName)
  return parts.join(' · ')
}

// library: entries in display order. included: Set of ids in the mix.
// groups: the active preset's Sound Groups ({ id, name, soundIds }).
export function buildRailRows(library, { included, groups = [], scope = 'All', query = '' }) {
  const q = query.trim().toLowerCase()
  const byId = new Map(library.map((entry) => [entry.id, entry]))
  if (scope === 'Groups') {
    return groups
      .filter((g) => g.name.toLowerCase().includes(q))
      .map((g) => {
        const members = g.soundIds.filter((id) => byId.has(id))
        const inMix = members.filter((id) => included.has(id)).length
        return { kind: 'group', id: g.id, name: g.name, meta: `group · ${inMix} of ${members.length} in mix`, in: inMix > 0, memberIds: members }
      })
  }
  const groupOf = new Map()
  for (const g of groups) for (const id of g.soundIds) if (!groupOf.has(id)) groupOf.set(id, g.name)
  return library
    .filter((entry) => (scope === 'All' || included.has(entry.id)) && entry.name.toLowerCase().includes(q))
    .map((entry) => ({
      kind: 'sound',
      id: entry.id,
      name: entry.name,
      meta: soundMeta(entry, groupOf.get(entry.id)),
      playType: railPlayType(entry),
      in: included.has(entry.id),
      missing: entry.status === 'missing'
    }))
}

// A group row is one switch for its members: any in the mix → take them all
// out; none in → put them all in. Returns the ids to toggle.
export function groupToggleIds(memberIds, included) {
  const anyIn = memberIds.some((id) => included.has(id))
  return memberIds.filter((id) => included.has(id) === anyIn)
}
