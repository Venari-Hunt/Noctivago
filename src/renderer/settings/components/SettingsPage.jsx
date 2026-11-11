import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { buildSidebar } from '../domain/sidebar.js'
import { splitByKind } from '../domain/pluginGroups.js'
import { syncPlugins, subscribePluginRuntime, getPluginRuntime, describeWaiting } from '../../core/PluginLoader.js'
import { listPluginSettingsPages, subscribePluginSettingsPages } from '../domain/pluginSettingsPages.js'
import { Sidebar } from './Sidebar.jsx'
import { GeneralPage } from './GeneralPage.jsx'
import { LibraryPage } from './LibraryPage.jsx'
import { CorePluginsPage } from './CorePluginsPage.jsx'
import { CommunityPluginsPage } from './CommunityPluginsPage.jsx'
import { PluginOptionsDialog } from './PluginOptionsDialog.jsx'
import { PrivacyPage } from './PrivacyPage.jsx'
import { HelpPage } from './HelpPage.jsx'
import { AboutPage } from './AboutPage.jsx'

// The Settings page (a tab with no tab-bar button, see settings/index.jsx):
// the list of pages on the left, the chosen page in a column on the right.
export function SettingsPage({ noctivago, initialPage = null }) {
  const [settings, setSettings] = useState(null)
  const [rawDescribed, setDescribed] = useState([])
  const [activeId, setActiveId] = useState(initialPage ?? 'general')
  const [optionsFor, setOptionsFor] = useState(null)
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
      restartApp: noctivago.pluginStore.restartApp,
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
  const pages = buildSidebar(described)
  const optionPageIds = new Set(loadedPages.map((p) => p.pluginId))
  const { core, community } = splitByKind(described)
  const optionsPage = loadedPages.find((p) => p.pluginId === optionsFor)
  const optionsTitle = described.find((d) => d.id === optionsFor)?.manifest.name

  function renderPage() {
    switch (activeId) {
      case 'library':
        return <LibraryPage settings={settings} api={api} />
      case 'core-plugins':
        return <CorePluginsPage plugins={core} pluginsApi={pluginsApi} optionPageIds={optionPageIds} onOpenOptions={setOptionsFor} />
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
            onOpenOptions={setOptionsFor}
          />
        )
      case 'help':
        return <HelpPage />
      case 'privacy':
        return <PrivacyPage />
      case 'about':
        return <AboutPage autoUpdate={noctivago.autoUpdate} />
      default:
        return <GeneralPage settings={settings} api={api} />
    }
  }

  return (
    <div className="sets">
      <Sidebar pages={pages} activeId={activeId} onSelect={setActiveId} />
      <div className="scol">
        {runtime.waiting.map((w) => (
          <div key={w.id} className="plugin-store-restart">
            <span>{describeWaiting(w)}</span>
          </div>
        ))}
        {settings ? renderPage() : <p className="plugin-store-dim">Loading…</p>}
      </div>
      {optionsPage && <PluginOptionsDialog title={optionsTitle ?? optionsPage.title} page={optionsPage} onClose={() => setOptionsFor(null)} />}
    </div>
  )
}
