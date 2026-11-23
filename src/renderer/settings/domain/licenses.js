// Splits THIRD_PARTY_NOTICES.md into one entry per "## Name (detail, License)"
// section, so About > Licenses lists what the app ships with straight from the
// file the repo already keeps. No DOM.
//
// Entry: { name, license, source, body } where body is the section's Markdown.

export function parseNotices(text) {
  const entries = []
  let current = null
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      current = { ...splitHeading(m[1]), lines: [] }
      entries.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }
  return entries.map(({ lines, ...entry }) => ({ ...entry, body: lines.join('\n').trim() }))
}

function splitHeading(heading) {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(heading)
  if (!m) return { name: heading, license: '', source: '' }
  const parts = m[2].split(',').map((s) => s.trim())
  return { name: m[1], license: parts.pop() ?? '', source: parts.join(', ') }
}
