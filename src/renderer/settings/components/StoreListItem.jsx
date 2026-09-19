import { downloadsLabel } from '../domain/storeBrowse.js'

// One plugin in the Browse window's left-hand list.
export function StoreListItem({ plugin, selected, onSelect }) {
  return (
    <li>
      <button type="button" className={`store-list-item${selected ? ' selected' : ''}`} onClick={onSelect}>
        <span className="store-list-item-title">
          <strong>{plugin.name}</strong>
          {plugin.official && <span className="plugin-store-badge">Official</span>}
          {plugin.installed && <span className="plugin-store-badge">Installed</span>}
        </span>
        <span className="plugin-store-dim">
          {plugin.author ? `By ${plugin.author} · ` : ''}
          {downloadsLabel(plugin.downloads)}
        </span>
        {plugin.description && <span className="store-list-item-desc">{plugin.description}</span>}
      </button>
    </li>
  )
}
