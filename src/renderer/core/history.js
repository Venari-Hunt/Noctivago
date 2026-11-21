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

  function push({ label, undo, redo, mergeKey } = {}) {
    if (running) return
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
      return
    }
    const entry = { label: label ?? '', undo, redo, mergeKey }
    undoStack.push(entry)
    if (undoStack.length > cap) undoStack.splice(0, undoStack.length - cap)
    redoStack = []
    lastPushed = entry
    lastPushAt = t
    notify()
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
