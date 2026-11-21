// App-wide undo/redo stack (pure, no DOM). Plan: vault "Undo history plan", Design 1.
//
// push({ label, undo, redo, mergeKey }): record an action that already happened.
// Same mergeKey within MERGE_MS of the last push merges into the previous entry
// (keeps its undo, takes the new redo and label), so one slider drag = one entry.
// A new push clears the redo stack. The stack is capped at CAP entries.

export const CAP = 100
export const MERGE_MS = 800

export function createHistory({ cap = CAP, mergeMs = MERGE_MS, now = () => Date.now() } = {}) {
  let undoStack = []
  let redoStack = []
  let lastPushAt = 0
  let lastPushed = null // the entry a merge may extend; null after undo/redo/clear
  let running = false // an undo/redo is running: its own setter calls must not record
  const listeners = new Set()

  const notify = () => { for (const fn of [...listeners]) fn() }

  // Returns the entry (so a caller can later remove() it), or undefined while an undo/redo runs.
  // ids (optional): the sound ids the entry touches, so removeForIds() can drop it.
  function push({ label, undo, redo, mergeKey, ids } = {}) {
    if (running) return undefined
    if (typeof undo !== 'function' || typeof redo !== 'function') {
      throw new TypeError('history.push needs undo and redo functions')
    }
    const t = now()
    if (
      mergeKey != null && lastPushed && lastPushed.mergeKey === mergeKey &&
      undoStack[undoStack.length - 1] === lastPushed && t - lastPushAt <= mergeMs
    ) {
      lastPushed.redo = redo
      lastPushed.label = label
      lastPushAt = t
      if (redoStack.length) redoStack = []
      notify()
      return lastPushed
    }
    const entry = { label: label ?? '', undo, redo, mergeKey, ids }
    undoStack.push(entry)
    if (undoStack.length > cap) undoStack.splice(0, undoStack.length - cap)
    redoStack = []
    lastPushed = entry
    lastPushAt = t
    notify()
    return entry
  }

  function step(from, to, run) {
    if (running || !from.length) return false
    const entry = from.pop()
    lastPushed = null
    running = true
    try {
      run(entry)
    } catch (err) {
      from.push(entry)
      throw err
    } finally {
      running = false
    }
    to.push(entry)
    notify()
    return true
  }

  return {
    push,
    undo: () => step(undoStack, redoStack, (e) => e.undo()),
    redo: () => step(redoStack, undoStack, (e) => e.redo()),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    // Labels of the next undo and redo, or null: { undo, redo }
    peekLabels: () => ({
      undo: undoStack.length ? undoStack[undoStack.length - 1].label : null,
      redo: redoStack.length ? redoStack[redoStack.length - 1].label : null,
    }),
    // The entry the next undo would run, or null.
    latest: () => undoStack[undoStack.length - 1] ?? null,
    // Drops one entry from either stack (an action that can no longer be undone
    // or redone, e.g. a delete whose files are gone). Returns whether it was there.
    remove(entry) {
      let found = false
      for (const stack of [undoStack, redoStack]) {
        const i = stack.indexOf(entry)
        if (i !== -1) { stack.splice(i, 1); found = true }
      }
      if (!found) return false
      if (lastPushed === entry) lastPushed = null
      notify()
      return true
    },
    // Drops every entry (either stack) that names one of these sound ids (push({ ids })),
    // for sounds whose files are gone: their setters would run on a sound that no longer exists.
    removeForIds(ids) {
      const gone = new Set(ids)
      const hits = (e) => e.ids?.some((id) => gone.has(id))
      const before = undoStack.length + redoStack.length
      undoStack = undoStack.filter((e) => !hits(e))
      redoStack = redoStack.filter((e) => !hits(e))
      if (undoStack.length + redoStack.length === before) return 0
      if (lastPushed && !undoStack.includes(lastPushed)) lastPushed = null
      notify()
      return before - undoStack.length - redoStack.length
    },
    clear() {
      if (!undoStack.length && !redoStack.length) { lastPushed = null; return }
      undoStack = []
      redoStack = []
      lastPushed = null
      notify()
    },
    // Subscribe to any change; returns the unsubscribe function.
    onChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

// The one app-wide history.
export const history = createHistory()
