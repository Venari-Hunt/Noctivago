// The repo-root CHANGELOG.md, inlined into the bundle at build time (no fs,
// no resources path to resolve, works identically in dev and packaged).
// Vite replaces this import with the file's text as a string literal.
import changelogText from '../../CHANGELOG.md?raw'

// Parses "## vX.Y.Z — Heading" sections into ordered entries, newest first
// (matching the file's own order). Everything between one heading and the
// next (or EOF) is that version's body, verbatim.
export function parseChangelog(text = changelogText) {
  const lines = String(text).split(/\r?\n/)
  const entries = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^##\s+v(\d+\.\d+\.\d+)\b(.*)$/)
    if (m) {
      if (current) entries.push(current)
      current = { version: m[1], heading: line.replace(/^##\s+/, '').trim(), bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }
  if (current) entries.push(current)
  return entries.map((e) => ({
    version: e.version,
    heading: e.heading,
    body: e.bodyLines.join('\n').trim()
  }))
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

// Every changelog entry strictly after `fromVersion` up to and including
// `toVersion` - so updating across several releases at once shows all of
// them, newest first. If `fromVersion` predates the changelog entirely (or
// isn't given), falls back to just the `toVersion` entry.
export function changelogEntriesBetween(fromVersion, toVersion) {
  const entries = parseChangelog()
  const inRange = entries.filter(
    (e) =>
      compareVersions(e.version, toVersion) <= 0 &&
      (!fromVersion || compareVersions(e.version, fromVersion) > 0)
  )
  if (inRange.length > 0) {
    return inRange.sort((a, b) => compareVersions(b.version, a.version))
  }
  const exact = entries.find((e) => e.version === toVersion)
  return exact ? [exact] : []
}

// Flattens the entries into one plain-text block for the What's-new screen's
// notes box (rendered pre-wrapped, same as the update-available notes).
export function changelogTextBetween(fromVersion, toVersion) {
  return changelogEntriesBetween(fromVersion, toVersion)
    .map((e) => `${e.heading}\n${e.body}`.trim())
    .join('\n\n')
}
