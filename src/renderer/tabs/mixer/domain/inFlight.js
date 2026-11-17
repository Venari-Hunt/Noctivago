// One in-flight promise per key: a second call for the same key while the
// first is still running gets the same promise instead of starting its own.
// Used by getOrCreateSource so two overlapping startPlayback calls (preset
// load + Play all) cannot each build a source for one sound; the loser would
// be orphaned yet already playing (never paused, never re-routed).
export function createInFlight() {
  const pending = new Map()
  return (key, fn) => {
    const running = pending.get(key)
    if (running) return running
    const p = (async () => fn())().finally(() => pending.delete(key))
    pending.set(key, p)
    return p
  }
}
