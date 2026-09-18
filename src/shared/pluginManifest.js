// Runtime check for a plugin's manifest.json. The TypeScript description of
// the same shape lives in types/plugin.d.ts (the contract plugin authors
// read); this is what actually runs, in src/main/plugins/registry.js, before
// a plugin is listed. Electron-free so it can be unit-tested directly.
//
// Returns every problem at once rather than stopping at the first, so a
// plugin author fixing their manifest sees the whole list in one log line.

// Lowercase letters, digits and dashes, starting with a letter or digit. The
// id becomes the plugin:// hostname, so it must be a valid URL host label.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
// Plain MAJOR.MINOR.PATCH, optionally with a -prerelease tag.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const REQUIRED_STRINGS = ['id', 'name', 'version', 'main']
const OPTIONAL_STRINGS = ['description', 'author', 'minAppVersion', 'mainProcess', 'styles']
// Fields naming a file inside the plugin's own folder.
const FILE_FIELDS = ['main', 'mainProcess', 'styles']

// A plugin file path must stay inside the plugin's folder: relative, no `..`
// segment, no drive letter or leading slash. plugin:// already guards renderer
// loads (protocol.js), but mainProcess is imported straight from disk by
// invoke.js, so this is its only check.
function isContainedRelativePath(value) {
  if (/^[a-zA-Z]:/.test(value) || value.startsWith('/') || value.startsWith('\\')) return false
  return !value.split(/[\\/]/).includes('..')
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be a JSON object'] }
  }

  const errors = []
  for (const key of REQUIRED_STRINGS) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
      errors.push(`"${key}" is required and must be a non-empty string`)
    }
  }
  for (const key of OPTIONAL_STRINGS) {
    if (manifest[key] !== undefined && typeof manifest[key] !== 'string') {
      errors.push(`"${key}" must be a string if present`)
    }
  }

  if (typeof manifest.id === 'string' && manifest.id && !ID_PATTERN.test(manifest.id)) {
    errors.push(`"id" must be lowercase letters, digits and dashes (got "${manifest.id}")`)
  }
  for (const key of ['version', 'minAppVersion']) {
    const value = manifest[key]
    if (typeof value === 'string' && value && !VERSION_PATTERN.test(value)) {
      errors.push(`"${key}" must look like 1.2.3 (got "${value}")`)
    }
  }
  for (const key of FILE_FIELDS) {
    const value = manifest[key]
    if (typeof value === 'string' && value && !isContainedRelativePath(value)) {
      errors.push(`"${key}" must be a relative path inside the plugin folder (got "${value}")`)
    }
  }

  return { ok: errors.length === 0, errors }
}
