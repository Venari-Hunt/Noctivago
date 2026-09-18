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
// JSX islands: a plain-JS plugin can also move just *part* of its UI to
// React. Every plugins/<id>/src/islands/<Name>.jsx is built to
// plugins/<id>/islands/<Name>.js, which the plugin's plain-JS code imports
// like any other module (e.g. Remix's filter sliders, see
// plugins/editor/src/islands/FilterControls.jsx). All of one plugin's
// islands are built together, so they share a single copy of React.
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
export const ISLANDS_SRC_DIR = 'src/islands'
export const ISLANDS_OUT_DIR = 'islands'
const ISLAND_EXTENSIONS = ['.jsx', '.tsx']

export function findEntry(pluginDir) {
  for (const candidate of ENTRY_CANDIDATES) {
    const full = path.join(pluginDir, candidate)
    if (fs.existsSync(full)) return full
  }
  return null
}

function listPluginDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, dir: path.join(root, d.name) }))
}

export function listBuildablePlugins(root = pluginsRoot) {
  return listPluginDirs(root)
    .map((p) => ({ ...p, entry: findEntry(p.dir) }))
    .filter((p) => p.entry)
}

export function findIslands(pluginDir) {
  const srcDir = path.join(pluginDir, ISLANDS_SRC_DIR)
  if (!fs.existsSync(srcDir)) return []
  return fs
    .readdirSync(srcDir)
    .filter((f) => ISLAND_EXTENSIONS.includes(path.extname(f)))
    .map((f) => path.join(srcDir, f))
}

export function listIslandPlugins(root = pluginsRoot) {
  return listPluginDirs(root)
    .map((p) => ({ ...p, islands: findIslands(p.dir) }))
    .filter((p) => p.islands.length)
}

// Settings shared by whole-plugin and island builds.
const sharedConfig = {
  configFile: false,
  logLevel: 'warn',
  // React checks process.env.NODE_ENV at runtime; the renderer has no
  // `process`, so it has to be replaced at build time.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  esbuild: { jsx: 'automatic' }
}

export async function buildPlugin({ id, dir, entry }, { watch = false } = {}) {
  return build({
    ...sharedConfig,
    root: path.dirname(entry),
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

export async function buildIslands({ id, dir, islands }, { watch = false } = {}) {
  const entries = Object.fromEntries(islands.map((f) => [path.basename(f, path.extname(f)), f]))
  return build({
    ...sharedConfig,
    root: path.join(dir, ISLANDS_SRC_DIR),
    build: {
      // A dedicated, fully generated folder - safe to wipe on every build.
      outDir: path.join(dir, ISLANDS_OUT_DIR),
      emptyOutDir: true,
      copyPublicDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: entries,
        formats: ['es'],
        fileName: (_format, name) => `${name}.js`
      },
      watch: watch ? {} : null
    }
  }).then((result) => {
    console.log(`[build-plugins] ${watch ? 'watching' : 'built'} ${id}/${ISLANDS_OUT_DIR}/ (${Object.keys(entries).join(', ')})`)
    return result
  })
}

async function main() {
  const args = process.argv.slice(2)
  const watch = args.includes('--watch')
  const only = args.filter((a) => !a.startsWith('--'))
  const pick = (list) => (only.length ? list.filter((p) => only.includes(p.id)) : list)

  const plugins = pick(listBuildablePlugins())
  const islandPlugins = pick(listIslandPlugins())
  if (!plugins.length && !islandPlugins.length) {
    console.log('[build-plugins] no JSX plugins to build')
    return
  }

  // Sequential, so one broken plugin's error is clearly attributed. In
  // watch mode each build() resolves to a watcher and keeps running.
  for (const plugin of plugins) await buildPlugin(plugin, { watch })
  for (const plugin of islandPlugins) await buildIslands(plugin, { watch })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
