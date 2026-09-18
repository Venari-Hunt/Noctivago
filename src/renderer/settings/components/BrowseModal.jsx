import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText } from '../domain/errorText.js'
import { StoreCard } from './StoreCard.jsx'

const LIST_REPO_URL = 'https://github.com/Venari-Hunt/noctivago-plugins'

// The community plugin browser, opened from Settings > Community plugins.
// The list, downloads and file changes all happen in the main process
// (src/main/plugins/store.js); this is only the UI.
export function BrowseModal({ store, restrictedMode, onChanged, onClose }) {
  const [plugins, setPlugins] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [latest, setLatest] = useState({})
  const [busy, setBusy] = useState({})
  const [query, setQuery] = useState('')
  const [onlyInstalled, setOnlyInstalled] = useState(false)

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
      onChanged()
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
      (p) => (!onlyInstalled || p.installed) && (!q || [p.name, p.author, p.description].some((s) => s.toLowerCase().includes(q)))
    )
  }, [plugins, query, onlyInstalled])

  return (
    <div className="modal settings-browse-modal">
      <div className="modal-card modal-card-wide">
        <h2>Community plugins</h2>
        <p className="plugin-store-hint">
          Community plugins are listed after a review in{' '}
          <a href={LIST_REPO_URL} target="_blank" rel="noreferrer">noctivago-plugins</a>, which also explains how to publish
          your own. A plugin can use everything the app can, so only install plugins you trust.
        </p>

        <div className="plugin-store-toolbar">
          <input type="search" placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className={`plugin-store-pill${onlyInstalled ? '' : ' active'}`} onClick={() => setOnlyInstalled(false)}>All</button>
          <button type="button" className={`plugin-store-pill${onlyInstalled ? ' active' : ''}`} onClick={() => setOnlyInstalled(true)}>Installed</button>
        </div>

        {loadError ? (
          <div className="plugin-store-error">
            Couldn’t load the plugin list: {loadError}{' '}
            <button className="btn btn-small" type="button" onClick={load}>Retry</button>
          </div>
        ) : plugins === null ? (
          <p className="plugin-store-dim">Loading plugins…</p>
        ) : shown.length === 0 ? (
          <p className="plugin-store-dim">{plugins.length === 0 ? 'No community plugins are listed yet.' : 'No plugins match.'}</p>
        ) : (
          <ul className="plugin-store-list">
            {shown.map((p) => (
              <StoreCard
                key={p.id}
                plugin={p}
                latest={latest[p.id]}
                busy={busy[p.id]}
                restrictedMode={restrictedMode}
                onInstall={(id) => run(id, p.installed ? 'Updating' : 'Installing', () => store.install(id))}
                onUninstall={(id) => run(id, 'Removing', () => store.uninstall(id))}
              />
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
