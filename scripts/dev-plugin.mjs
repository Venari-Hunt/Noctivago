// Loads a local plugin build into the dev app (userData noctivago-dev).
//   node scripts/dev-plugin.mjs <plugin-repo-folder> [--no-build] [--repo Owner/name]
// Builds the plugin (npm run build), then copies manifest.json plus every
// file it names (main, styles) into %APPDATA%\noctivago-dev\plugins\<id>\.
// Writes .origin.json with the official repo so Restricted mode lets it load.
// The running dev app live-reloads it when idle (see docs/plugins.md).
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const src = path.resolve(args.find((a) => !a.startsWith('--')) || '')
if (!args.length || !fs.existsSync(path.join(src, 'manifest.json'))) {
  console.error('usage: node scripts/dev-plugin.mjs <plugin-repo-folder> [--no-build] [--repo Owner/name]')
  process.exit(1)
}
if (!args.includes('--no-build')) execSync('npm run build', { cwd: src, stdio: 'inherit' })

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf-8'))
const ri = args.indexOf('--repo')
const repo = ri >= 0 ? args[ri + 1] : `Venari-Hunt/noctivago-${manifest.id}`
const dest = path.join(process.env.APPDATA, 'noctivago-dev', 'plugins', manifest.id)
fs.mkdirSync(dest, { recursive: true })
const files = new Set(['manifest.json', manifest.main, manifest.styles].filter(Boolean))
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dest, f))
fs.writeFileSync(path.join(dest, '.origin.json'), JSON.stringify({ repo }))
console.log(`${manifest.id} ${manifest.version} -> ${dest} (${[...files].join(', ')})`)
