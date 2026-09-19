import { useEffect, useState } from 'react'
import { errorText } from '../domain/errorText.js'
import { downloadsLabel } from '../domain/storeBrowse.js'
import { Markdown } from './Markdown.jsx'
import { Toggle } from './Toggle.jsx'

// The Browse window's right-hand pane: one plugin's details, actions and
// README. Installs are refused (by main too) for third-party plugins while
// Restricted mode is on.
export function PluginDetail({ plugin, latest, busy, restrictedMode, loadState, hasOptions, store, onInstall, onUninstall, onToggle, onOpenOptions, onBack }) {
  const [confirming, setConfirming] = useState(false)
  const [readme, setReadme] = useState(null)
  const { installed } = plugin
  const builtIn = installed?.source === 'bundled'
  const blocked = restrictedMode && !plugin.official

  useEffect(() => {
    let cancelled = false
    setConfirming(false)
    setReadme(null)
    store
      .readme(plugin.id)
      .then((r) => !cancelled && setReadme(r))
      .catch((err) => !cancelled && setReadme({ error: errorText(err) }))
    return () => {
      cancelled = true
    }
  }, [store, plugin.id])

  function requestInstall() {
    // A mainProcess module runs outside the renderer sandbox, so it gets an
    // explicit second click. Unknown (latest not checked yet) also asks.
    if (!latest || latest.error || latest.mainProcess) setConfirming(true)
    else onInstall()
  }

  const facts = [
    plugin.author && `By ${plugin.author}`,
    downloadsLabel(plugin.downloads),
    latest?.version && `Version ${latest.version}`,
    plugin.updated && `Updated ${new Date(plugin.updated).toLocaleDateString()}`
  ].filter(Boolean)

  return (
    <div className="store-detail">
      <button type="button" className="btn btn-small store-detail-back" onClick={onBack}>← All plugins</button>
      <h3 className="store-detail-title">
        {plugin.name}
        {plugin.official && <span className="plugin-store-badge">Official</span>}
        {installed && <span className="plugin-store-badge">{builtIn ? 'Built in' : `Installed v${installed.version}`}</span>}
      </h3>
      <p className="plugin-store-dim">{facts.join(' · ')}</p>
      <a className="plugin-store-dim plugin-store-link" href={`https://github.com/${plugin.repo}`} target="_blank" rel="noreferrer">
        github.com/{plugin.repo}
      </a>
      {plugin.description && <p className="plugin-store-desc">{plugin.description}</p>}

      <div className="store-detail-actions">
        {busy ? (
          <span className="plugin-store-dim">{busy}…</span>
        ) : installed ? (
          <>
            {!builtIn && latest?.updateAvailable && (
              <button className="btn btn-small btn-primary" type="button" onClick={requestInstall}>Update to v{latest.version}</button>
            )}
            {loadState && loadState !== 'restricted' && (
              <span className="store-detail-enable">
                <Toggle checked={loadState === 'enabled'} label={`Enable ${plugin.name}`} onChange={onToggle} />
                {loadState === 'enabled' ? 'Enabled' : 'Disabled'}
              </span>
            )}
            {hasOptions && <button className="btn btn-small" type="button" onClick={onOpenOptions}>Options</button>}
            {!builtIn && <button className="btn btn-small btn-danger" type="button" onClick={onUninstall}>Uninstall</button>}
          </>
        ) : blocked ? (
          <span className="plugin-store-dim">Turn off Restricted mode to install</span>
        ) : (
          !confirming && (
            <button className="btn btn-small btn-primary" type="button" onClick={requestInstall}>
              Install{latest?.version ? ` v${latest.version}` : ''}
            </button>
          )
        )}
      </div>
      {loadState === 'restricted' && <p className="settings-plugin-warning">Blocked by Restricted mode.</p>}
      {latest?.error && <p className="plugin-store-error">{latest.error}</p>}
      {confirming && (
        <div className="plugin-store-confirm">
          <p>
            {latest?.mainProcess
              ? 'This plugin also runs code outside the app’s sandbox, with full access to your files and computer.'
              : 'Couldn’t check what this plugin contains.'}{' '}
            Only install it if you trust its author.
          </p>
          <button className="btn btn-small btn-danger" type="button" onClick={() => { setConfirming(false); onInstall() }}>
            Install anyway
          </button>{' '}
          <button className="btn btn-small" type="button" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}

      <hr className="store-detail-rule" />
      {readme === null ? (
        <p className="plugin-store-dim">Loading README…</p>
      ) : readme.error ? (
        <p className="plugin-store-error">Couldn’t load the README: {readme.error}</p>
      ) : !readme.text.trim() ? (
        <p className="plugin-store-dim">This plugin has no README.</p>
      ) : (
        <>
          <Markdown source={readme.text} repo={plugin.repo} />
          {readme.truncated && <p className="plugin-store-dim">README cut short. Read the rest on GitHub.</p>}
        </>
      )}
    </div>
  )
}
