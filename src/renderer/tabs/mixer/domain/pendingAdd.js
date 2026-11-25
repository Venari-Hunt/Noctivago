// The placeholder row for a sound still being added from a link (micro-interactions mock, row
// "Add a sound"): it fills with the download, then the real row arrives; a failure stays on the
// row with Retry and Remove. DOM-free, unit tested.

// A name for the row before the sound has one: the typed name, else the link's last path part
// or its host.
export function pendingName(url, typed = '') {
  if (typed.trim()) return typed.trim()
  try {
    const u = new URL(url)
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
    const host = u.hostname.replace(/^www\./, '')
    if (/youtu\.?be/.test(host)) return host
    return last.replace(/\.[a-z0-9]{2,5}$/i, '') || host
  } catch {
    return 'New sound'
  }
}

// The row's second line and its ring for each state.
//   { state: 'working', percent: null | 0-100, step } · { state: 'done' } · { state: 'fail', reason }
export function pendingRow(job) {
  if (!job) return null
  if (job.state === 'done') return { meta: 'Added', ring: 100, tone: 'done' }
  if (job.state === 'fail') return { meta: `Couldn't download: ${shortFailure(job.reason)}`, ring: null, tone: 'fail' }
  if (job.percent == null) return { meta: job.step || 'Starting…', ring: null, tone: 'working' }
  const p = Math.max(0, Math.min(100, Math.round(job.percent)))
  return { meta: `Downloading… ${p}%`, ring: p, tone: 'working' }
}

// Main returns one finished sentence per failure; the row has one line, so drop the trailing
// period and keep it short (the full text is the row's tooltip).
export function shortFailure(reason, max = 60) {
  const t = String(reason || 'Download failed').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim().replace(/\.$/, '')
  const lower = t.charAt(0).toLowerCase() + t.slice(1)
  return lower.length > max ? lower.slice(0, max - 1).trimEnd() + '…' : lower
}
