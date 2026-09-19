// What the renderer's plugin manager (renderer/core/PluginLoader.js) has to
// do to go from the plugins running now to the ones that should run:
// `running` and `wanted` are [{ id, version }]. Returns ids to unload
// (running, no longer wanted), load (wanted, not running), swap (running an
// older or different version) and unchanged. Order follows `wanted`, which
// is registry order, so tabs come up in a stable order.
export function planPluginSync(running, wanted) {
  const runningById = new Map(running.map((p) => [p.id, p.version]))
  const wantedIds = new Set(wanted.map((p) => p.id))
  const plan = { unload: [], load: [], swap: [], unchanged: [] }
  for (const p of running) if (!wantedIds.has(p.id)) plan.unload.push(p.id)
  for (const p of wanted) {
    if (!runningById.has(p.id)) plan.load.push(p.id)
    else if (runningById.get(p.id) !== p.version) plan.swap.push(p.id)
    else plan.unchanged.push(p.id)
  }
  return plan
}
