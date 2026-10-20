// Text for Settings → Library → "Compress library sounds". No DOM.
import { formatSize } from '../../util/size.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// state: { info: { count, bytes, pendingCount, running } | null, progress: { done, total } | null, result: { converted, skipped, savedBytes } | null }
export function compressView({ info, progress, result }) {
  if (progress) return { status: `Compressing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`, canStart: false, canRestart: false }
  if (result) {
    const parts = []
    if (result.converted > 0) parts.push(`${plural(result.converted, 'sound')} compressed, freeing ${formatSize(result.savedBytes)}. Restart Noctívago to finish.`)
    else parts.push('Nothing was compressed.')
    if (result.skipped > 0) parts.push(`${plural(result.skipped, 'file')} stayed WAV: FLAC can't hold them exactly, or wasn't smaller.`)
    return { status: parts.join(' '), canStart: false, canRestart: result.converted > 0 || (info?.pendingCount ?? 0) > 0 }
  }
  if (!info) return { status: '', canStart: false, canRestart: false }
  if (info.running) return { status: 'Compressing…', canStart: false, canRestart: false }
  const waiting = info.pendingCount > 0 ? ` ${plural(info.pendingCount, 'compressed file')} waiting for a restart.` : ''
  if (info.count === 0) return { status: `No WAV sounds left to compress.${waiting}`.trim(), canStart: false, canRestart: info.pendingCount > 0 }
  return { status: `${plural(info.count, 'WAV file')}, ${formatSize(info.bytes)}.${waiting}`, canStart: true, canRestart: info.pendingCount > 0 }
}
