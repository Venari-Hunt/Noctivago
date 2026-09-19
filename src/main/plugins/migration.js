import { getPlugins } from './registry.js'
import { listCatalog, install } from './store.js'
import { missingOfficialPlugins, needsPluginMigration } from '../../shared/officialPlugins.js'
import { getSettings, setPluginSplitMigrated } from '../settings.js'
import { listSounds } from '../library.js'

// One-time install of the official plugins for people who had them built in
// before the plugin store split, so updating doesn't take Remix, Export and
// the rest away. Starts at launch; plugins:list waits for it (up to a limit)
// so the downloads load this same session. If it fails (offline), it runs
// again next launch, and the Mixer's Recommended plugins card offers them
// meanwhile.
const WAIT_LIMIT_MS = 20000

let running = null

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
  if (missing.length) {
    await listCatalog()
    for (const plugin of missing) {
      try {
        await install(plugin.id)
        console.log(`Plugin migration: installed ${plugin.id}`)
      } catch (err) {
        failed++
        console.error(`Plugin migration: couldn't install ${plugin.id}`, err)
      }
    }
  }
  if (!failed) setPluginSplitMigrated()
}

// Called once at app start, before the settings that decide it change.
export function startPluginMigration() {
  running = migrate().catch((err) => console.error('Plugin migration failed', err))
}

// Resolves when the migration finished, or after WAIT_LIMIT_MS so a slow
// connection never keeps plugins from loading. Installs that finish later
// load on the next launch.
export function pluginMigrationSettled() {
  if (!running) return Promise.resolve()
  return Promise.race([running, new Promise((resolve) => setTimeout(resolve, WAIT_LIMIT_MS))])
}
