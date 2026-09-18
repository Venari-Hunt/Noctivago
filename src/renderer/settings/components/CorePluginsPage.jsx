import { PluginRow } from './PluginRow.jsx'

export function CorePluginsPage({ plugins, pluginsApi, optionPageIds, onOpenOptions }) {
  return (
    <>
      <h3 className="settings-page-heading">Core plugins</h3>
      <p className="settings-page-hint">Features that ship with Noctívago. Switch off the ones you don't use; changes apply after a restart.</p>
      <ul className="settings-plugin-list">
        {plugins.map((p) => (
          <PluginRow
            key={p.id}
            plugin={p}
            hasOptions={p.loaded && optionPageIds.has(p.id)}
            onOpenOptions={() => onOpenOptions(p.id)}
            onToggle={(on) => pluginsApi.setEnabled(p.id, on)}
          />
        ))}
      </ul>
    </>
  )
}
