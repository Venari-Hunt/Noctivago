// Plugin copy of src/shared/credits.js (the plugin can't import from src/) -
// test/credits.test.js checks the two stay identical.
// Sound credits (v0.1.224) - shared by the main process (detecting and
// storing where a sound came from) and the Export plugin's info file (which
// keeps its own copy, plugins/export/credits.js - the plugin can't import
// from src/; keep the two in sync). No Electron imports, so it's
// unit-testable (test/credits.test.js).

// Freesound's own download names: "<sound id>__<username>__<sound name>.<ext>",
// e.g. "331589__kentspublicdomain__rain-on-roof.wav". Usernames may contain
// single underscores, so the first "__" after the id ends the username only
// if another "__" follows.
const FREESOUND_FILE_NAME = /^(\d{1,10})__(.+?)__(.+)$/

export function parseFreesoundFileName(fileName) {
  const base = String(fileName ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^.]+$/, '')
  const match = FREESOUND_FILE_NAME.exec(base)
  if (!match) return null
  const [, id, username, title] = match
  return {
    freesoundId: Number(id),
    username,
    // A re-encode step often appends "_optimized" to the downloaded name.
    title: title.replace(/[-_ ]optimized$/i, '').replace(/[-_]+/g, ' ').trim(),
    pageUrl: freesoundPageUrl(id, username)
  }
}

export function freesoundPageUrl(freesoundId, username) {
  return username
    ? `https://freesound.org/people/${encodeURIComponent(username)}/sounds/${freesoundId}/`
    : `https://freesound.org/s/${freesoundId}/`
}

// Freesound reports a license as a Creative Commons URL (older sounds) or a
// name ("Attribution", "Creative Commons 0", ...). Returns a short label
// plus whether the license requires crediting the author.
export function describeLicense(license) {
  const text = String(license ?? '').trim()
  if (!text) return { label: 'license unknown', attribution: true }
  const lower = text.toLowerCase()
  if (lower.includes('publicdomain/zero') || lower.includes('cc0') || lower === 'creative commons 0') {
    return { label: 'CC0 (public domain)', attribution: false }
  }
  if (lower.includes('sampling+') || lower.includes('sampling-plus')) return { label: 'CC Sampling+ 1.0', attribution: true }
  const url = /licenses\/([a-z-]+)\/(\d(?:\.\d)?)/.exec(lower)
  if (url) return { label: `CC ${url[1].toUpperCase()} ${url[2]}`, attribution: true }
  const byName = /^attribution([ -]noncommercial)?(?: (\d\.\d))?$/.exec(lower)
  if (byName) {
    const version = byName[2] ? ` ${byName[2]}` : ''
    return { label: `CC BY${byName[1] ? '-NC' : ''}${version}`, attribution: true }
  }
  return { label: text, attribution: true }
}

// One credits line for a library entry's `source`, or null when there's
// nothing to credit (a local file of unknown origin).
export function creditLine(soundName, source) {
  if (!source) return null
  if (source.type === 'freesound') {
    const title = source.title || soundName
    const { label } = describeLicense(source.license)
    const by = source.username ? ` by ${source.username}` : ''
    const url = source.pageUrl || freesoundPageUrl(source.freesoundId, source.username)
    return `"${title}"${by} (Freesound) - ${label} - ${url}`
  }
  if (source.type === 'url' && source.url) {
    return `"${soundName}" - from ${source.url}`
  }
  return null
}
