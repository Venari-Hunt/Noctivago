// Rules for the Browse window's plugin list: search, "installed only",
// sorting and the download count label. No DOM.

export const SORTS = [
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'name', label: 'Name' },
  { id: 'updated', label: 'Recently updated' }
]

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

const COMPARE = {
  downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0) || byName(a, b),
  name: byName,
  // Plugins with no stats yet sort last.
  updated: (a, b) => (b.updated ?? -Infinity) - (a.updated ?? -Infinity) || byName(a, b)
}

export function browsePlugins(plugins, { query = '', onlyInstalled = false, sort = 'downloads' } = {}) {
  const q = query.trim().toLowerCase()
  return plugins
    .filter((p) => (!onlyInstalled || p.installed) && (!q || [p.name, p.author, p.description].some((s) => s?.toLowerCase().includes(q))))
    .sort(COMPARE[sort] ?? COMPARE.downloads)
}

// 950 → "950", 1234 → "1.2k", 12345 → "12k", 1234567 → "1.2M".
export function formatCount(n) {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.floor(n || 0)))
  const [value, unit] = n < 1e6 ? [n / 1e3, 'k'] : [n / 1e6, 'M']
  const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)
  return `${shown}${unit}`
}

export function downloadsLabel(n) {
  return `${formatCount(n)} download${n === 1 ? '' : 's'}`
}
