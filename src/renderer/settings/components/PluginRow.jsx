import { Toggle } from './Toggle.jsx'

// One installed plugin: toggle, and for community plugins an optional
// update button and uninstall. The gear opens the plugin's own settings page.
export function PluginRow({ plugin, hasOptions, onToggle, onOpenOptions, onUninstall, update, busy }) {
  const { manifest, state } = plugin
  const restricted = state === 'restricted'

  return (
    <li className="settings-plugin-row">
      <div className="settings-item-info">
        <div className="settings-item-name">
          {manifest.name}
          <span className="settings-plugin-version">v{manifest.version}</span>
          {plugin.kind === 'community' && plugin.official && <span className="plugin-store-badge">Official</span>}
        </div>
        {manifest.author && plugin.kind === 'community' && <div className="settings-item-desc">By {manifest.author}</div>}
        {manifest.description && <div className="settings-item-desc">{manifest.description}</div>}
        {restricted && <div className="settings-item-desc settings-plugin-warning">Blocked by Restricted mode.</div>}
      </div>
      <div className="settings-item-control">
        {busy ? (
          <span className="plugin-store-dim">{busy}…</span>
        ) : (
          <>
            {update && (
              <button className="btn btn-small btn-primary" type="button" onClick={update.onClick}>Update to v{update.version}</button>
            )}
            {hasOptions && (
              <button className="btn btn-icon" type="button" title="Options" onClick={onOpenOptions}>⚙</button>
            )}
            {onUninstall && (
              <button className="btn btn-small btn-danger" type="button" onClick={onUninstall}>Uninstall</button>
            )}
            <Toggle checked={state === 'enabled'} disabled={restricted} label={`Enable ${manifest.name}`} onChange={onToggle} />
          </>
        )}
      </div>
    </li>
  )
}
