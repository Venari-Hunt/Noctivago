// Desktop 2.0 step 20: the old app (v0.1.274, the last release before the
// redesign) and the new build side by side, each on its own copy of the real
// profile, for the owner's audit with the vault's Desktop feature checklist.
//   node scripts/side-by-side.mjs [--fresh] [--no-launch]
// First run: makes a git worktree of v0.1.274 next to this repo
// (../noctivago-audit-old), installs and builds it (a few minutes), and copies
// %APPDATA%\noctivago into %APPDATA%\noctivago-audit-old and -audit-new
// (about 3 GB each). Later runs reuse all of it; --fresh copies the profiles
// again. The real profile is only read.
// In both copies: sleep timer auto-start, app updates and plugin updates are
// off, and community.json (your Community author key) is left out, so
// nothing you do there can touch your public uploads. The new copy gets the
// 2.0 plugin builds from %APPDATA%\noctivago-dev\plugins. The old window is
// muted, so only the new one plays.
import { execSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OLD_REF = 'be0c70d' // "Changelog and lockfile for v0.1.274" (no tag)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const oldDir = path.resolve(repo, '../noctivago-audit-old')
const appData = process.env.APPDATA
const REAL = path.join(appData, 'noctivago')
const DEV_PLUGINS = path.join(appData, 'noctivago-dev', 'plugins')
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'DevToolsActivePort', 'community.json', 'download-tmp', 'phone-export-tmp', 'recording-tmp', 'logs'])
const fresh = process.argv.includes('--fresh')
const launch = !process.argv.includes('--no-launch')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // set in VS Code shells; Electron would start as plain Node

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env })

function ensureOldBuild() {
  if (!fs.existsSync(oldDir)) run(`git worktree add --detach "${oldDir}" ${OLD_REF}`, repo)
  // The old app always used the noctivago-dev profile when unpackaged; teach
  // this throwaway copy the same NOCTIVAGO_PROFILE switch the new one has.
  const devMode = path.join(oldDir, 'src/main/devMode.js')
  const src = fs.readFileSync(devMode, 'utf8')
  if (!src.includes('NOCTIVAGO_PROFILE')) {
    const patched = src.replace("app.setName('noctivago-dev')", "app.setName(process.env.NOCTIVAGO_PROFILE || 'noctivago-dev')")
    if (patched === src) throw new Error('could not patch the old devMode.js')
    fs.writeFileSync(devMode, patched)
    fs.rmSync(path.join(oldDir, 'out'), { recursive: true, force: true })
  }
  if (!fs.existsSync(path.join(oldDir, 'node_modules'))) run('npm ci', oldDir)
  if (!fs.existsSync(path.join(oldDir, 'out/main/index.js'))) run('npm run build', oldDir)
}

function makeProfile(name, pluginsFrom) {
  const dest = path.join(appData, name)
  if (fs.existsSync(dest) && !fresh) return dest
  console.log(`Copying your profile to ${dest} …`)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(REAL, dest, { recursive: true, filter: (from) => !SKIP.has(path.relative(REAL, from).split(path.sep)[0]) })
  if (pluginsFrom && fs.existsSync(pluginsFrom)) {
    fs.rmSync(path.join(dest, 'plugins'), { recursive: true, force: true })
    fs.cpSync(pluginsFrom, path.join(dest, 'plugins'), { recursive: true })
  }
  const settingsFile = path.join(dest, 'settings.json')
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
  Object.assign(settings, { sleepTimerAutoStart: false, autoUpdateEnabled: false, autoInstallUpdates: false, autoUpdatePlugins: false })
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
  return dest
}

function start(dir, profile, extraArgs = []) {
  const electron = createRequire(path.join(dir, 'package.json'))('electron')
  const child = spawn(electron, ['.', ...extraArgs], { cwd: dir, env: { ...env, NOCTIVAGO_PROFILE: profile }, detached: true, stdio: 'ignore' })
  child.unref()
}

ensureOldBuild()
run('npm run build', repo)
makeProfile('noctivago-audit-old')
makeProfile('noctivago-audit-new', DEV_PLUGINS)
if (launch) {
  start(oldDir, 'noctivago-audit-old', ['--mute-audio'])
  start(repo, 'noctivago-audit-new')
  console.log('Opened: old v0.1.274 (muted) and the new 2.0 build. Snap them side by side with Win+Left / Win+Right.')
}
