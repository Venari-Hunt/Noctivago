import { useState } from 'react'

// One plugin in the Browse window. Installs are refused (by main too) for
// third-party plugins while Restricted mode is on.
export function StoreCard({ plugin, latest, busy, restrictedMode, onInstall, onUninstall }) {
  const [confirming, setConfirming] = useState(false)
  const { installed } = plugin
  const builtIn = installed?.source === 'bundled'
  const blocked = restrictedMode && !plugin.official

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
          {plugin.official && <span className="plugin-store-badge">Official</span>}
          {installed && <span className="plugin-store-badge">{builtIn ? 'Built in' : `Installed v${installed.version}`}</span>}
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
            <button className="btn btn-small btn-danger" type="button" onClick={() => { setConfirming(false); onInstall(plugin.id) }}>
              Install anyway
            </button>{' '}
            <button className="btn btn-small" type="button" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
      </div>
      <div className="plugin-store-card-actions">
        {busy ? (
          <span className="plugin-store-dim">{busy}…</span>
        ) : builtIn ? null : installed ? (
          <>
            {latest?.updateAvailable && (
              <button className="btn btn-small btn-primary" type="button" onClick={requestInstall}>Update to v{latest.version}</button>
            )}
            <button className="btn btn-small" type="button" onClick={() => onUninstall(plugin.id)}>Uninstall</button>
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
    </li>
  )
}
