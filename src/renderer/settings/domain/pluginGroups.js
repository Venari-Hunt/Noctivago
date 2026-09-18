// Splits plugins:describe output into the two Settings pages and works out
// whether the saved settings differ from what's running this session.
export function splitByKind(described) {
  const byName = (a, b) => a.manifest.name.localeCompare(b.manifest.name)
  return {
    core: described.filter((p) => p.kind === 'core').sort(byName),
    community: described.filter((p) => p.kind === 'community').sort(byName)
  }
}

export function needsRestart(described) {
  return described.some((p) => (p.state === 'enabled') !== p.loaded)
}
