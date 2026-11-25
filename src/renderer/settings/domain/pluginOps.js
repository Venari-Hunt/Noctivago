import { errorText } from './errorText.js'

// Words for a plugin install, update or removal shown on the morphing status chip
// (micro-interactions mock, row "Plugin install and update"). DOM-free, unit tested.
export function pluginOpWords(kind, version) {
  const v = version ? ` to v${version}` : ''
  if (kind === 'update') return { working: `Updating${v}`, done: `Updated${v}`, fail: failWords }
  if (kind === 'remove') return { working: 'Removing', done: 'Removed', fail: failWords }
  return { working: 'Installing', done: 'Installed', fail: failWords }
}

// The chip has room for a short reason; the full one stays in the page text.
export function shortReason(text, max = 40) {
  const t = String(text ?? '').trim() || 'Failed'
  if (/fetch failed|network|ENOTFOUND|ECONN|offline|internet/i.test(t)) return 'Offline. Try again'
  if (/HTTP 404/.test(t)) return 'Release not found'
  const plain = t.replace(/\s*(for|from|at)\s+https?:\/\/\S+/gi, '').replace(/https?:\/\/\S+/gi, '').trim() || 'Failed'
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain
}

function failWords(err) {
  return shortReason(errorText(err))
}
