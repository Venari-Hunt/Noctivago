import { addPluginSettingsPage } from '../settings/domain/pluginSettingsPages.js'
import { notify } from './Notifications.js'
import { planPluginSync } from '../../shared/pluginSync.js'

// Loads every enabled plugin (bundled + user-installed, see
// src/main/plugins/registry.js) into the TabHost, and keeps them in step with
// what's installed and switched on - live, without restarting the app.
// Installs, updates, removals, on/off toggles and Restricted mode all go
// through syncPlugins(): it diffs what should run (plugins:list) against
// what is running and loads, unloads or swaps plugins to match.
//
// A plugin is only unloaded or swapped while it's idle, so nothing in use is
// pulled out from under anyone: none of its tabs is on screen, no export is
// running (Export's UI is a plugin), and its instance doesn't report
// isBusy() (Remix does while there are unsaved edits). Otherwise the change
// waits and is retried when the tab changes and every few seconds; anything
// that finishes later like that is announced with a notification.
//
// Each plugin is loaded independently in its own try/catch: a broken plugin
// is skipped (and announced), it never blocks the app or other plugins.

const RETRY_MS = 15000

let tabHost = null
let generation = 0
// id -> { version, name, instance, tabIds, pageRemovers, link, keepSlots }
const running = new Map()
// id -> { kind: 'update' | 'unload', name, version }
const waiting = new Map()
// id -> version that failed to start; not retried (or re-announced) until a
// different version is installed.
const failed = new Map()
let syncChain = Promise.resolve()
let retryTimer = null

const listeners = new Set()
let snapshot = { running: {}, waiting: [] }

function emit() {
  snapshot = {
    running: Object.fromEntries([...running].map(([id, r]) => [id, r.version])),
    waiting: [...waiting].map(([id, w]) => ({ id, ...w }))
  }
  for (const listener of listeners) listener()
}

// For the Settings window (useSyncExternalStore): which plugin versions are
// running and which changes are waiting for a plugin to be idle.
export function subscribePluginRuntime(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPluginRuntime() {
  return snapshot
}

async function isIdle(id) {
  const record = running.get(id)
  if (!record) return true
  if (record.tabIds.has(tabHost.getActiveId())) return false
  try {
    if (await window.noctivago.plugins.isExportRunning()) return false
  } catch {
    return false
  }
  try {
    if (record.instance?.isBusy?.()) return false
  } catch (err) {
    console.error(`Plugin "${id}" isBusy() threw`, err)
  }
  return true
}

async function load(id, manifest) {
  const key = `@${encodeURIComponent(manifest.version)}-${++generation}`
  const record = { version: manifest.version, name: manifest.name, instance: null, tabIds: new Set(), pageRemovers: [], link: null, keepSlots: false }
  try {
    if (manifest.styles) {
      record.link = document.createElement('link')
      record.link.rel = 'stylesheet'
      record.link.href = `plugin://${id}/${key}/${manifest.styles}`
      document.head.appendChild(record.link)
    }

    const module = await import(/* @vite-ignore */ `plugin://${id}/${key}/${manifest.main}`)
    const PluginClass = module.default
    if (typeof PluginClass !== 'function') {
      throw new Error('Plugin module has no default export class')
    }

    const appApi = {
      tabs: {
        register: (tabDef) => {
          tabHost.register(tabDef)
          record.tabIds.add(tabDef.id)
          // Once the host took the tab down (teardown), a late call from the
          // old instance must not remove the next version's tab of that id.
          return () => {
            if (!record.tabIds.delete(tabDef.id)) return
            tabHost.unregister(tabDef.id, { keepSlot: record.keepSlots })
          }
        }
      },
      settings: {
        addPage: (page) => {
          const remove = addPluginSettingsPage(id, page)
          record.pageRemovers.push(remove)
          return remove
        }
      },
      notifications: { show: (options) => notify({ ...options, title: options?.title ?? manifest.name }) },
      noctivago: window.noctivago,
      plugin: { id, manifest }
    }

    record.instance = new PluginClass(appApi, manifest)
    await record.instance.onload?.()
    running.set(id, record)
    failed.delete(id)
    return true
  } catch (err) {
    console.error(`Failed to load plugin "${id}"`, err)
    teardown(record)
    failed.set(id, manifest.version)
    notify({ tone: 'error', key: `plugin-${id}`, title: manifest.name, message: `Couldn't start ${manifest.name} ${manifest.version}: ${err.message}` })
    return false
  }
}

// Removes whatever the plugin left registered (its own onunload normally
// does this; a plugin that forgets still gets cleaned up).
function teardown(record) {
  for (const tabId of [...record.tabIds]) tabHost.unregister(tabId, { keepSlot: record.keepSlots })
  record.tabIds.clear()
  for (const remove of record.pageRemovers) remove()
  record.link?.remove()
}

async function unload(id, { keepSlots = false } = {}) {
  const record = running.get(id)
  if (!record) return []
  const tabIds = [...record.tabIds]
  record.keepSlots = keepSlots
  try {
    await record.instance?.onunload?.()
  } catch (err) {
    console.error(`Plugin "${id}" onunload() failed`, err)
  }
  teardown(record)
  running.delete(id)
  return tabIds
}

async function swap(id, manifest) {
  const oldTabs = await unload(id, { keepSlots: true })
  await load(id, manifest)
  const kept = running.get(id)?.tabIds ?? new Set()
  for (const tabId of oldTabs) if (!kept.has(tabId)) tabHost.dropSlot(tabId)
}

async function doSync() {
  let wanted
  try {
    wanted = await window.noctivago.plugins.list()
  } catch (err) {
    console.error('Failed to list plugins', err)
    return
  }
  const plan = planPluginSync(
    [...running].map(([id, r]) => ({ id, version: r.version })),
    wanted.map(({ id, manifest }) => ({ id, version: manifest.version }))
  )
  const manifests = new Map(wanted.map((p) => [p.id, p.manifest]))
  const before = new Map(waiting)

  for (const id of plan.unload) {
    const record = running.get(id)
    if (await isIdle(id)) {
      // Keep its place, so switching it back on puts the tab where it was.
      await unload(id, { keepSlots: true })
      waiting.delete(id)
    } else {
      waiting.set(id, { kind: 'unload', name: record.name, version: record.version })
    }
  }
  for (const id of plan.load) {
    if (failed.get(id) === manifests.get(id).version) continue
    await load(id, manifests.get(id))
    waiting.delete(id)
  }
  for (const id of plan.swap) {
    const manifest = manifests.get(id)
    if (await isIdle(id)) {
      await swap(id, manifest)
      waiting.delete(id)
    } else {
      waiting.set(id, { kind: 'update', name: manifest.name, version: manifest.version, from: running.get(id).version })
    }
  }
  // Anything no longer needing a change (e.g. switched back on) stops waiting.
  for (const id of plan.unchanged) waiting.delete(id)

  // Changes that waited and have now happened were done without anyone
  // watching - say so.
  for (const [id, w] of before) {
    if (waiting.has(id)) continue
    if (w.kind === 'update' && running.get(id)?.version === w.version) {
      notify({ tone: 'success', key: `plugin-${id}`, title: w.name, message: `Updated to ${w.version}.` })
    } else if (w.kind === 'unload' && !running.has(id)) {
      notify({ key: `plugin-${id}`, title: w.name, message: `${w.name} is now off.` })
    }
  }

  clearInterval(retryTimer)
  retryTimer = waiting.size ? setInterval(() => syncPlugins(), RETRY_MS) : null
  emit()
}

// Brings running plugins in line with what's installed and switched on.
// Calls queue up, so two never interleave. Resolves with the runtime snapshot.
export function syncPlugins() {
  syncChain = syncChain.then(doSync, doSync)
  return syncChain.then(() => snapshot)
}

function waitingMessage(name, version) {
  return `${name} ${version} is downloaded. It switches over as soon as ${name} isn't in use: its tab isn't open, nothing is unsaved, and no export is running.`
}

async function onAutoUpdated({ updated = [], failed = [] }) {
  await syncPlugins()
  for (const u of updated) {
    const w = waiting.get(u.id)
    if (w?.kind === 'update') {
      notify({ key: `plugin-${u.id}`, title: u.name, message: waitingMessage(u.name, u.to) })
    } else if (running.get(u.id)?.version === u.to) {
      notify({ tone: 'success', key: `plugin-${u.id}`, title: u.name, message: `Updated automatically from ${u.from} to ${u.to}.` })
    }
  }
  for (const f of failed) {
    notify({ tone: 'error', key: `plugin-${f.id}`, title: f.name, message: `Couldn't update automatically: ${f.error}` })
  }
}

async function showStartupNotices() {
  let notices = []
  try {
    notices = await window.noctivago.plugins.takeStartupNotices()
  } catch {
    return
  }
  for (const n of notices) {
    if (n.kind === 'migrated') {
      notify({
        tone: 'success',
        key: 'plugin-migration',
        title: 'Plugins downloaded',
        message: `${n.names.join(', ')} used to be built in and are now plugins. They were downloaded for you, so everything works as before.`
      })
    }
  }
}

export async function loadPlugins(host) {
  tabHost = host
  await syncPlugins()
  window.noctivago.plugins.onAutoUpdated((result) => onAutoUpdated(result).catch((err) => console.error(err)))
  window.noctivago.plugins.onChanged(() => {
    syncPlugins().then(showStartupNotices)
  })
  tabHost.onActivate(() => {
    if (waiting.size) syncPlugins()
  })
  await showStartupNotices()
}

// Plugins' own "the user is waiting on this" message, for Settings.
export function describeWaiting(entry) {
  return entry.kind === 'update' ? waitingMessage(entry.name, entry.version) : `${entry.name} turns off as soon as it isn't in use.`
}
