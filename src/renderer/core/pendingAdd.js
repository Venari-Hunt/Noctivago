import { pendingName } from '../tabs/mixer/domain/pendingAdd.js'
import { MORPH_TIMING } from '../ui/domain/morphStates.js'

// One sound being added from a link, shown as a placeholder row in the library rail (micro-
// interactions mock, row "Add a sound") instead of holding the dialog open. Main downloads one link
// at a time (library:cancelAddSoundFromUrl stops "the" download), so there is at most one job.
let job = null
const listeners = new Set()
let holdTimer = null

function set(next) {
  job = next
  for (const fn of listeners) fn(job)
}

export function pendingAdd() {
  return job
}

export function onPendingAdd(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function isAdding() {
  return job?.state === 'working'
}

export async function startPendingAdd(request) {
  clearTimeout(holdTimer)
  const name = pendingName(request.url, request.name)
  set({ state: 'working', name, percent: null, step: 'Starting…', request })
  const unsubscribe = window.noctivago.library.onAddSoundFromUrlProgress((u) => {
    if (!job || job.state !== 'working' || !u) return
    if (u.type === 'progress') set({ ...job, percent: u.percent })
    else if (u.type === 'step' && u.message) set({ ...job, step: u.message })
  })
  try {
    await window.noctivago.library.addSoundFromUrl(request)
    document.dispatchEvent(new CustomEvent('library:linked'))
    if (!job || job.state !== 'working') return // removed while it finished
    set({ ...job, state: 'done', percent: 100 })
    holdTimer = setTimeout(() => set(null), MORPH_TIMING.doneHold)
  } catch (err) {
    if (!job || job.state !== 'working') return // removed (canceled) by the person
    set({ ...job, state: 'fail', reason: err?.message || 'Download failed' })
  } finally {
    unsubscribe()
  }
}

export function retryPendingAdd() {
  if (job?.request) startPendingAdd(job.request)
}

// Remove drops a failed row; on a running one it also stops the download.
export function removePendingAdd() {
  clearTimeout(holdTimer)
  if (job?.state === 'working') window.noctivago.library.cancelAddSoundFromUrl()
  set(null)
}
