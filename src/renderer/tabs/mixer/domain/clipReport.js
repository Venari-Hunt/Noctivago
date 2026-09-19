// Clip report rules (Clip Diagnostics Design): turns a clip meter's latched
// peak into "what clipped, by how much, and the one-click fix". No DOM - the
// popover (components/ClipReport.jsx) only renders what this returns.

// Random Interval / Scheduled sounds roll a new take each time, so the next
// one can be a little louder than the one that clipped. The fix leaves this
// much room on top of the measured over.
export const HEADROOM_DB = 1

// Remix's group gain slider range; a group fix never pushes past it.
export const GROUP_GAIN_MIN_DB = -24

const MAX_LISTED = 3

export function toDb(peak) {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

export function formatDb(db) {
  if (!Number.isFinite(db)) return '-inf dB'
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

// How far to lower: the over plus headroom, rounded up to half a dB so the
// button reads cleanly ("Lower Rain by 3.5 dB").
export function fixAmountDb(overDb) {
  return Math.ceil((Math.max(0, overDb) + HEADROOM_DB) * 2) / 2
}

export function lowerGain(gain, db) {
  return gain * Math.pow(10, -db / 20)
}

// Returns the new group gain and whether the slider's floor cut the fix short.
export function lowerGroupGainDb(gainDb, db) {
  const wanted = (gainDb ?? 0) - db
  return { gainDb: Math.max(GROUP_GAIN_MIN_DB, wanted), capped: wanted < GROUP_GAIN_MIN_DB }
}

// source: { kind: 'sound'|'group'|'mix', id, name, maxPeak,
//   members: [{ id, name, peak }] } - members are the sounds feeding a group
//   or the mix, with their own peak when the clip was caught.
// Returns { heading, detail, loudest, note, fix } where fix is
//   { kind: 'sound'|'group'|'all', id?, lowerDb, label } or null when nothing
//   is over anymore.
export function buildClipReport({ kind, id, name, maxPeak, members = [] }) {
  const overDb = toDb(maxPeak)
  const over = formatDb(overDb)
  const clipped = overDb >= 0
  const lowerDb = fixAmountDb(overDb)

  const loudest = members
    .filter((m) => m.peak > 0)
    .sort((a, b) => b.peak - a.peak)
    .slice(0, MAX_LISTED)
    .map((m) => ({ id: m.id, name: m.name, db: toDb(m.peak), label: `${m.name} ${formatDb(toDb(m.peak))}` }))
  const hot = loudest.filter((m) => m.db >= 0)

  if (kind === 'sound') {
    return {
      heading: clipped ? `${name} clipped by ${over} on its own.` : `${name} peaked at ${over}.`,
      detail: clipped ? 'Its own volume is pushing it past 0 dB.' : 'It is not clipping.',
      loudest: [],
      note: clipped ? headroomNote() : null,
      fix: clipped ? { kind: 'sound', id, lowerDb, label: `Lower ${name} by ${lowerDb} dB` } : null
    }
  }

  const detail = hot.length
    ? `${hot.map((m) => m.name).join(', ')} ${hot.length === 1 ? 'is' : 'are'} too loud on ${hot.length === 1 ? 'its' : 'their'} own.`
    : 'No single sound is too loud; they add up.'

  if (kind === 'group') {
    return {
      heading: clipped ? `Group ${name} clipped by ${over}.` : `Group ${name} peaked at ${over}.`,
      detail: clipped ? detail : 'It is not clipping.',
      loudest,
      note: clipped ? headroomNote() : null,
      fix: clipped ? { kind: 'group', id, lowerDb, label: `Lower the ${name} group by ${lowerDb} dB` } : null
    }
  }

  return {
    heading: clipped ? `The whole mix clipped by ${over}.` : `The whole mix peaked at ${over}.`,
    detail: clipped ? detail : 'It is not clipping.',
    loudest,
    note: clipped ? `Lowers every playing sound by the same amount, so your balance stays the same. ${headroomNote()}` : null,
    fix: clipped ? { kind: 'all', lowerDb, label: `Lower every sound by ${lowerDb} dB` } : null
  }
}

function headroomNote() {
  return `Includes ${HEADROOM_DB} dB of extra room, since random sounds can roll a louder take next time.`
}
