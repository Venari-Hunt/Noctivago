// The Plugins tab: the in-app plugin store (step 4 of the React plan). The
// list, downloads and file changes all happen in the main process
// (src/main/plugins/store.js, reached through window.noctivago.pluginStore);
// this is only the UI. Installs take effect after a restart, since plugins
// are loaded once at startup.
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useState } from 'react'

const LIST_REPO_URL = 'https://github.com/Venari-Hunt/noctivago-plugins'

function errorText(err) {
  // ipcRenderer.invoke wraps main-process errors as "Error invoking remote method '...': Error: <msg>".
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function PluginCard({ plugin, latest, busy, onInstall, onUninstall }) {
  const [confirming, setConfirming] = useState(false)
  const { installed } = plugin
  const builtIn = installed?.source === 'bundled'
  const updateAvailable = latest?.updateAvailable

  function requestInstall() {
    // A mainProcess module runs outside the renderer sandbox, so it gets an
    // explicit second click. Unknown (latest not checked yet) also asks.
    if (!latest || latest.error || latest.mainProcess) setConfirming(true)
    else onInstall(plugin.id)
  }

  return (
    <li className="plugin-store-card">
      <div className="plugin-store-card-main">
        <div className="plugin-store-card-title">
          <strong>{plugin.name}</strong>
          {plugin.author && <span className="plugin-store-dim"> by {plugin.author}</span>}
          {installed && (
            <span className="plugin-store-badge">{builtIn ? 'Built in' : `Installed v${installed.version}`}</span>
          )}
        </div>
        {plugin.description && <p className="plugin-store-desc">{plugin.description}</p>}
        <a className="plugin-store-dim plugin-store-link" href={`https://github.com/${plugin.repo}`} target="_blank" rel="noreferrer">
          github.com/{plugin.repo}
        </a>
        {latest?.error && <p className="plugin-store-error">{latest.error}</p>}
        {confirming && (
          <div className="plugin-store-confirm">
            <p>
              {latest?.mainProcess
                ? 'This plugin also runs code outside the app’s sandbox, with full access to your files and computer.'
                : 'Couldn’t check what this plugin contains.'}{' '}
              Only install it if you trust its author.
            </p>
            <button className="btn btn-small btn-danger" onClick={() => { setConfirming(false); onInstall(plugin.id) }}>
              Install anyway
            </button>{' '}
            <button className="btn btn-small" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="plugin-store-card-actions">
        {busy ? (
          <span className="plugin-store-dim">{busy}…</span>
        ) : builtIn ? null : installed ? (
          <>
            {updateAvailable && (
              <button className="btn btn-small btn-primary" onClick={requestInstall}>Update to v{latest.version}</button>
            )}
            <button className="btn btn-small" onClick={() => onUninstall(plugin.id)}>Uninstall</button>
          </>
        ) : (
          !confirming && (
            <button className="btn btn-small btn-primary" onClick={requestInstall}>
              Install{latest?.version ? ` v${latest.version}` : ''}
            </button>
          )
        )}
      </div>
    </li>
  )
}

function PluginStore({ store }) {
  const [plugins, setPlugins] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [latest, setLatest] = useState({})
  const [busy, setBusy] = useState({})
  const [query, setQuery] = useState('')
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [needsRestart, setNeedsRestart] = useState(false)

  const checkLatest = useCallback(
    (id) =>
      store
        .checkLatest(id)
        .then((info) => setLatest((l) => ({ ...l, [id]: info })))
        .catch((err) => setLatest((l) => ({ ...l, [id]: { error: errorText(err) } }))),
    [store]
  )

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const { plugins } = await store.list()
      setPlugins(plugins)
      // Update check (and the mainProcess warning) for everything listed.
      for (const p of plugins) if (p.installed?.source !== 'bundled') checkLatest(p.id)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [store, checkLatest])

  useEffect(() => {
    load()
  }, [load])

  async function run(id, label, action) {
    setBusy((b) => ({ ...b, [id]: label }))
    try {
      await action()
      setNeedsRestart(true)
      const { plugins } = await store.list()
      setPlugins(plugins)
      await checkLatest(id)
    } catch (err) {
      setLatest((l) => ({ ...l, [id]: { ...l[id], error: errorText(err) } }))
    } finally {
      setBusy((b) => ({ ...b, [id]: null }))
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (plugins ?? []).filter(
      (p) =>
        (!onlyInstalled || p.installed) &&
        (!q || [p.name, p.author, p.description].some((s) => s.toLowerCase().includes(q)))
    )
  }, [plugins, query, onlyInstalled])

  return (
    <div className="plugin-store">
      <p className="plugin-store-hint">
        Community plugins are made by other people and listed after a review in{' '}
        <a href={LIST_REPO_URL} target="_blank" rel="noreferrer">noctivago-plugins</a>, which also explains how to
        publish your own. A plugin can use everything the app can, so only install plugins you trust.
      </p>

      {needsRestart && (
        <div className="plugin-store-restart">
          <span>Restart Noctívago to apply your plugin changes.</span>
          <button className="btn btn-small btn-primary" onClick={() => store.restartApp()}>Restart now</button>
        </div>
      )}

      <div className="plugin-store-toolbar">
        <input type="search" placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`plugin-store-pill${onlyInstalled ? '' : ' active'}`} onClick={() => setOnlyInstalled(false)}>All</button>
        <button className={`plugin-store-pill${onlyInstalled ? ' active' : ''}`} onClick={() => setOnlyInstalled(true)}>Installed</button>
      </div>

      {loadError ? (
        <div className="plugin-store-error">
          Couldn’t load the plugin list: {loadError}{' '}
          <button className="btn btn-small" onClick={load}>Retry</button>
        </div>
      ) : plugins === null ? (
        <p className="plugin-store-dim">Loading plugins…</p>
      ) : shown.length === 0 ? (
        <p className="plugin-store-dim">
          {plugins.length === 0 ? 'No community plugins are listed yet.' : 'No plugins match.'}
        </p>
      ) : (
        <ul className="plugin-store-list">
          {shown.map((p) => (
            <PluginCard
              key={p.id}
              plugin={p}
              latest={latest[p.id]}
              busy={busy[p.id]}
              onInstall={(id) => run(id, p.installed ? 'Updating' : 'Installing', () => store.install(id))}
              onUninstall={(id) => run(id, 'Removing', () => store.uninstall(id))}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export default class PluginStorePlugin {
  /**
   * @param {import('../../../types/plugin').PluginApp} app
   * @param {import('../../../types/plugin').PluginManifest} manifest
   */
  constructor(app, manifest) {
    this.app = app
    this.manifest = manifest
    this.root = null
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'plugin-store',
      title: 'Plugins',
      mount: (container) => {
        this.root = createRoot(container)
        this.root.render(<PluginStore store={this.app.noctivago.pluginStore} />)
      }
    })
  }

  async onunload() {
    this.root?.unmount()
    this.unregister?.()
  }
}
