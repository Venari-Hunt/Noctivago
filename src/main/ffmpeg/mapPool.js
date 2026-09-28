// Runs `worker` over `items` with at most `concurrency` in flight at once.
// Preserves the pre-toggle behavior exactly at concurrency 1 (a plain
// sequential walk). On the first worker error every runner stops pulling new
// items, but the pool still waits for the (at most `concurrency`-1) already
// in-flight workers to settle before rethrowing - otherwise those stragglers
// would keep spawning ffmpeg after exportMix has already returned failure,
// and their temp paths would land in the cleanup arrays *after* the finally
// block already ran (a real leak under "Faster export").
export async function mapPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  let firstError = null
  async function runner() {
    while (firstError === null) {
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch (err) {
        if (firstError === null) firstError = err
        return
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, runner))
  if (firstError) throw firstError
}
