import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { buildSidebar, pluginPageId } from '../domain/sidebar.js'
import { splitByKind } from '../domain/pluginGroups.js'
import { syncPlugins, subscribePluginRuntime, getPluginRuntime, describeWaiting } from '../../core/PluginLoader.js'
import { listPluginSettingsPages, subscribePluginSettingsPages } from '../domain/pluginSettingsPages.js'
import { Sidebar } from './Sidebar.jsx'
import { GeneralPage } from './GeneralPage.jsx'
import { LibraryPage } from './LibraryPage.jsx'
import { CorePluginsPage } from './CorePluginsPage.jsx'
import { CommunityPluginsPage } from './CommunityPluginsPage.jsx'
import { PluginOptionsPage } from './PluginOptionsPage.jsx'

export function SettingsWindow({ noctivago, onClose }) {
  const [settings, setSettings] = useState(null)
  const [rawDescribed, setDescribed] = useState([])
  const [activeId, setActiveId] = useState('general')
  const pluginPages = useSyncExternalStore(subscribePluginSettingsPages, listPluginSettingsPages)
  // Plugin changes apply live (core/PluginLoader.js); `loaded` is what's
  // actually running now, which lags the saved state only while a busy
  // plugin's change is waiting.
  const runtime = useSyncExternalStore(subscribePluginRuntime, getPluginRuntime)
  const described = rawDescribed.map((p) => ({ ...p, loaded: p.id in runtime.running }))

  const reloadPlugins = useCallback(() => noctivago.plugins.describe().then(setDescribed), [noctivago])
  const applyChanges = useCallback(() => syncPlugins().then(reloadPlugins), [reloadPlugins])

  useEffect(() => {
    noctivago.settings.get().then(setSettings)
    reloadPlugins()
  }, [noctivago, reloadPlugins])

  const api = useMemo(
    () => ({
      library: noctivago.library,
      update: async (change) => setSettings(await change(noctivago.settings))
    }),
    [noctivago]
  )

  const pluginsApi = useMemo(
    () => ({
      setEnabled: async (id, on) => {
        setSettings(await noctivago.plugins.setEnabled(id, on))
        await applyChanges()
      },
      setRestrictedMode: async (on) => {
        setSettings(await noctivago.plugins.setRestrictedMode(on))
        await applyChanges()
      },
      setAutoUpdate: async (on) => setSettings(await noctivago.plugins.setAutoUpdate(on)),
      reload: reloadPlugins,
      applyChanges
    }),
    [noctivago, reloadPlugins, applyChanges]
  )

  const loadedPages = pluginPages.filter((p) => described.find((d) => d.id === p.pluginId)?.loaded)
  const groups = buildSidebar(loadedPages, described)
  const optionPageIds = new Set(loadedPages.map((p) => p.pluginId))
  const { core, community } = splitByKind(described)
  const openOptions = (pluginId) => setActiveId(pluginPageId(pluginId))
  const activePluginPage = loadedPages.find((p) => pluginPageId(p.pluginId) === activeId)

  function renderPage() {
    switch (activeId) {
      case 'general':
        return <GeneralPage settings={settings} api={api} />
      case 'library':
        return <LibraryPage settings={settings} api={api} />
      case 'core-plugins':
        return <CorePluginsPage plugins={core} pluginsApi={pluginsApi} optionPageIds={optionPageIds} onOpenOptions={openOptions} />
      case 'community-plugins':
        return (
          <CommunityPluginsPage
            plugins={community}
            allPlugins={described}
            restrictedMode={settings.restrictedMode}
            autoUpdate={settings.autoUpdatePlugins}
            pluginsApi={pluginsApi}
            store={noctivago.pluginStore}
            optionPageIds={optionPageIds}
            onOpenOptions={openOptions}
          />
        )
      default:
        return activePluginPage ? <PluginOptionsPage page={activePluginPage} /> : <GeneralPage settings={settings} api={api} />
    }
  }

  return (
    <div className="modal-card settings-window">
      <Sidebar groups={groups} activeId={activeId} onSelect={setActiveId} />
      <div className="settings-page">
        <div className="settings-page-top">
          <h2>Settings</h2>
          <button className="btn btn-icon" type="button" title="Close" onClick={onClose}>✕</button>
        </div>
        {runtime.waiting.map((w) => (
          <div key={w.id} className="plugin-store-restart">
            <span>{describeWaiting(w)}</span>
          </div>
        ))}
        {settings ? renderPage() : <p className="plugin-store-dim">Loading…</p>}
      </div>
    </div>
  )
}
