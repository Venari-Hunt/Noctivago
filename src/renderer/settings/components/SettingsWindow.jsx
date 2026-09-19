import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { buildSidebar, pluginPageId } from '../domain/sidebar.js'
import { splitByKind, needsRestart } from '../domain/pluginGroups.js'
import { listPluginSettingsPages, subscribePluginSettingsPages } from '../domain/pluginSettingsPages.js'
import { Sidebar } from './Sidebar.jsx'
import { GeneralPage } from './GeneralPage.jsx'
import { LibraryPage } from './LibraryPage.jsx'
import { CorePluginsPage } from './CorePluginsPage.jsx'
import { CommunityPluginsPage } from './CommunityPluginsPage.jsx'
import { PluginOptionsPage } from './PluginOptionsPage.jsx'
import { RestartBanner } from './RestartBanner.jsx'

export function SettingsWindow({ noctivago, onClose }) {
  const [settings, setSettings] = useState(null)
  const [described, setDescribed] = useState([])
  const [activeId, setActiveId] = useState('general')
  // Uninstalls drop a plugin from `described`, so needsRestart() alone
  // can't see them.
  const [changedThisSession, setChangedThisSession] = useState(false)
  const pluginPages = useSyncExternalStore(subscribePluginSettingsPages, listPluginSettingsPages)

  const reloadPlugins = useCallback(() => noctivago.plugins.describe().then(setDescribed), [noctivago])

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
        reloadPlugins()
      },
      setRestrictedMode: async (on) => {
        setSettings(await noctivago.plugins.setRestrictedMode(on))
        reloadPlugins()
      },
      reload: reloadPlugins,
      markChanged: () => setChangedThisSession(true)
    }),
    [noctivago, reloadPlugins]
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
        {(changedThisSession || needsRestart(described)) && <RestartBanner onRestart={() => noctivago.pluginStore.restartApp()} />}
        {settings ? renderPage() : <p className="plugin-store-dim">Loading…</p>}
      </div>
    </div>
  )
}
