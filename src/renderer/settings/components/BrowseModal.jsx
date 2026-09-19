import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText } from '../domain/errorText.js'
import { SORTS, browsePlugins } from '../domain/storeBrowse.js'
import { StoreListItem } from './StoreListItem.jsx'
import { PluginDetail } from './PluginDetail.jsx'

const LIST_REPO_URL = 'https://github.com/Venari-Hunt/noctivago-plugins'

// The community plugin browser, opened from Settings > Community plugins,
// laid out like Obsidian's: search, sort and the list on the left, the
// chosen plugin's details and README on the right. The list, downloads and
// file changes all happen in the main process (src/main/plugins/store.js).
export function BrowseModal({ store, restrictedMode, described, optionPageIds, onToggle, onOpenOptions, onChanged, onClose }) {
  const [plugins, setPlugins] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [latest, setLatest] = useState({})
  const [busy, setBusy] = useState({})
  const [query, setQuery] = useState('')
  const [onlyInstalled, setOnlyInstalled] = useState(false)
  const [sort, setSort] = useState('downloads')
  const [selectedId, setSelectedId] = useState(null)

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

  const shown = useMemo(() => browsePlugins(plugins ?? [], { query, onlyInstalled, sort }), [plugins, query, onlyInstalled, sort])
  const selected = plugins?.find((p) => p.id === selectedId)

  return (
    <div className="modal settings-browse-modal">
      <div className="modal-card store-browser-card">
        <div className="settings-page-top">
          <h2>Community plugins</h2>
          <button className="btn btn-icon" type="button" title="Close" onClick={onClose}>✕</button>
        </div>

        <div className={`store-browser${selected ? ' has-selection' : ''}`}>
          <div className="store-list-pane">
            <div className="plugin-store-toolbar">
              <input type="search" placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="plugin-store-toolbar">
              <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button type="button" className={`plugin-store-pill${onlyInstalled ? ' active' : ''}`} onClick={() => setOnlyInstalled((v) => !v)}>
                Installed only
              </button>
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
              <>
                <p className="plugin-store-dim">Showing {shown.length} plugin{shown.length === 1 ? '' : 's'}</p>
                <ul className="store-list">
                  {shown.map((p) => (
                    <StoreListItem key={p.id} plugin={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="store-detail-pane">
            {selected ? (
              <PluginDetail
                plugin={selected}
                latest={latest[selected.id]}
                busy={busy[selected.id]}
                restrictedMode={restrictedMode}
                loadState={described.find((d) => d.id === selected.id)?.state}
                hasOptions={optionPageIds.has(selected.id)}
                store={store}
                onInstall={() => run(selected.id, selected.installed ? 'Updating' : 'Installing', () => store.install(selected.id))}
                onUninstall={() => run(selected.id, 'Removing', () => store.uninstall(selected.id))}
                onToggle={(on) => onToggle(selected.id, on)}
                onOpenOptions={() => onOpenOptions(selected.id)}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="store-detail-empty">
                <p className="plugin-store-dim">Pick a plugin to see its details.</p>
                <p className="plugin-store-hint">
                  Community plugins are listed after a review in{' '}
                  <a href={LIST_REPO_URL} target="_blank" rel="noreferrer">noctivago-plugins</a>, which also explains how to publish
                  your own. A plugin can use everything the app can, so only install plugins you trust.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
