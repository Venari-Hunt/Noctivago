// Builds every plugin under plugins/ that has a JSX source entry
// (plugins/<id>/src/index.jsx) into a single self-contained ES module at
// plugins/<id>/main.js - the file its manifest's "main" points at.
//
// Why a build step at all: plugins are served raw over plugin:// and
// import()ed straight into the renderer (see src/main/plugins/protocol.js),
// so the browser has to be handed plain JS - no JSX, no bare "react"
// imports. Each plugin bundles its own copy of React rather than sharing the
// app's: the plugin contract stays framework-free (mount(container)), so a
// plugin's framework is its own business, exactly like an Obsidian plugin.
//
// Plain-JS plugins (no src/index.jsx) are skipped and keep working as-is.
//
// Usage:
//   node scripts/build-plugins.mjs            build all JSX plugins once
//   node scripts/build-plugins.mjs --watch    rebuild on change (dev)
//   node scripts/build-plugins.mjs <id> ...   only the named plugins
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsRoot = path.join(repoRoot, 'plugins')

const ENTRY_CANDIDATES = ['src/index.jsx', 'src/index.tsx', 'src/index.js']
export const OUTPUT_FILE = 'main.js'

export function findEntry(pluginDir) {
  for (const candidate of ENTRY_CANDIDATES) {
    const full = path.join(pluginDir, candidate)
    if (fs.existsSync(full)) return full
  }
  return null
}

export function listBuildablePlugins(root = pluginsRoot) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, dir: path.join(root, d.name) }))
    .map((p) => ({ ...p, entry: findEntry(p.dir) }))
    .filter((p) => p.entry)
}

export async function buildPlugin({ id, dir, entry }, { watch = false } = {}) {
  return build({
    configFile: false,
    root: path.dirname(entry),
    logLevel: 'warn',
    // React checks process.env.NODE_ENV at runtime; the renderer has no
    // `process`, so it has to be replaced at build time.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    esbuild: { jsx: 'automatic' },
    build: {
      outDir: dir,
      // outDir is the plugin folder itself - never wipe it.
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry,
        formats: ['es'],
        fileName: () => OUTPUT_FILE
      },
      // CSS imports from JSX aren't supported: a plugin ships a plain
      // styles.css through its manifest's "styles" field, which
      // PluginLoader.js links in.
      watch: watch ? {} : null
    }
  }).then((result) => {
    console.log(`[build-plugins] ${watch ? 'watching' : 'built'} ${id}/${OUTPUT_FILE}`)
    return result
  })
}

async function main() {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const only = args.filter((a) => !a.startsWith('--'))

  let plugins = listBuildablePlugins()
  if (only.length) plugins = plugins.filter((p) => only.includes(p.id))
  if (!plugins.length) {
    console.log('[build-plugins] no JSX plugins to build')
    return
  }

  // Sequential, so one broken plugin's error is clearly attributed. In
  // watch mode each build() resolves to a watcher and keeps running.
  for (const plugin of plugins) await buildPlugin(plugin, { watch })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
