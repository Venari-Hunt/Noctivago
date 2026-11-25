// Timing and words for the micro-interaction states (ui/morphButton.js), kept
// DOM-free so they are unit tested. Times from the approved mock
// (mock-noctivago-micro.html): spinner only after 400 ms, done/canceled held
// 1.4 s, a failure stays 4.2 s.
export const MORPH_TIMING = { workingDelay: 400, doneHold: 1400, failHold: 4200 }

export const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Words shown in a state row: escaped, and long reasons cut so the button never grows past the panel.
export function morphLabel(text, max = 48) {
  const t = String(text ?? '').trim()
  return escapeHtml(t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t)
}

// What the Import button says once a preset import ends.
export function importResultLabel(result) {
  if (!result?.ok) return { state: 'fail', text: result?.error || 'Import failed' }
  const missing = result.failedCount || 0
  if (missing) return { state: 'done', text: `Imported, ${missing} sound${missing === 1 ? '' : 's'} missing` }
  return { state: 'done', text: 'Imported to Presets' }
}
