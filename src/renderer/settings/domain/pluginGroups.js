// Splits plugins:describe output into the two Settings pages.
export function splitByKind(described) {
  const byName = (a, b) => a.manifest.name.localeCompare(b.manifest.name)
  return {
    core: described.filter((p) => p.kind === 'core').sort(byName),
    community: described.filter((p) => p.kind === 'community').sort(byName)
  }
}
