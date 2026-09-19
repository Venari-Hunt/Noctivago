import { getPlugins } from './registry.js'
import { listCatalog, install } from './store.js'
import { missingOfficialPlugins, needsPluginMigration } from '../../shared/officialPlugins.js'
import { getSettings, setPluginSplitMigrated } from '../settings.js'
import { listSounds } from '../library.js'
import { notifyPluginsChanged } from './autoUpdate.js'

// One-time install of the official plugins for people who had them built in
// before the plugin store split, so updating doesn't take Remix, Export and
// the rest away. Starts at launch; plugins:list waits for it (up to a limit)
// so the downloads load this same session. If it fails (offline), it runs
// again next launch, and the Mixer's Recommended plugins card offers them
// meanwhile. What it installed is kept for takeStartupNotices(), so the main
// window can say so (it happens without being asked).
const WAIT_LIMIT_MS = 20000

let running = null
let notices = []

async function migrate() {
  const settings = getSettings()
  const owed = needsPluginMigration({
    migrated: settings.pluginSplitMigrated,
    lastRunVersion: settings.lastRunVersion,
    soundCount: listSounds().length
  })
  if (!owed) {
    if (!settings.pluginSplitMigrated) setPluginSplitMigrated()
    return
  }

  const missing = missingOfficialPlugins(getPlugins().map((p) => p.id))
  let failed = 0
  const installed = []
  if (missing.length) {
    const { plugins: listed } = await listCatalog()
    for (const plugin of missing) {
      try {
        await install(plugin.id)
        installed.push(listed.find((p) => p.id === plugin.id)?.name ?? plugin.id)
        console.log(`Plugin migration: installed ${plugin.id}`)
      } catch (err) {
        failed++
        console.error(`Plugin migration: couldn't install ${plugin.id}`, err)
      }
    }
  }
  if (!failed) setPluginSplitMigrated()
  if (installed.length) {
    notices.push({ kind: 'migrated', names: installed })
    // Installs that finished after plugins:list stopped waiting load live now.
    notifyPluginsChanged()
  }
}

// Returns and clears what the startup migration did quietly.
export function takeStartupNotices() {
  const out = notices
  notices = []
  return out
}

// Called once at app start, before the settings that decide it change.
export function startPluginMigration() {
  running = migrate().catch((err) => console.error('Plugin migration failed', err))
}

// Resolves when the migration finished, or after WAIT_LIMIT_MS so a slow
// connection never keeps plugins from loading. Installs that finish later
// load live when the main window re-syncs.
export function pluginMigrationSettled() {
  if (!running) return Promise.resolve()
  return Promise.race([running, new Promise((resolve) => setTimeout(resolve, WAIT_LIMIT_MS))])
}
