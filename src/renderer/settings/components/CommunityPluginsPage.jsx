import { useState } from 'react'
import { errorText } from '../domain/errorText.js'
import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'
import { PluginRow } from './PluginRow.jsx'
import { BrowseModal } from './BrowseModal.jsx'

export function CommunityPluginsPage({ plugins, allPlugins, restrictedMode, pluginsApi, store, optionPageIds, onOpenOptions }) {
  const [confirmingUnrestrict, setConfirmingUnrestrict] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [updates, setUpdates] = useState({})
  const [busy, setBusy] = useState({})
  const [checkStatus, setCheckStatus] = useState('')

  function onRestrictedChange(on) {
    if (on) pluginsApi.setRestrictedMode(true)
    else setConfirmingUnrestrict(true)
  }

  async function checkForUpdates() {
    setCheckStatus('Checking…')
    try {
      // Loads the list first: main looks each plugin's repo up in it.
      const { plugins: listed } = await store.list()
      const listedIds = new Set(listed.map((p) => p.id))
      const found = {}
      for (const p of plugins.filter((p) => listedIds.has(p.id))) {
        const info = await store.checkLatest(p.id)
        if (info.updateAvailable) found[p.id] = info.version
      }
      setUpdates(found)
      const count = Object.keys(found).length
      setCheckStatus(count ? `${count} update${count === 1 ? '' : 's'} available.` : 'Everything is up to date.')
    } catch (err) {
      setCheckStatus(`Couldn’t check: ${errorText(err)}`)
    }
  }

  // Returns whether the action worked, so Update all can count failures.
  async function run(id, label, action) {
    setBusy((b) => ({ ...b, [id]: label }))
    try {
      await action()
      setUpdates((u) => ({ ...u, [id]: undefined }))
      pluginsApi.markChanged()
      return true
    } catch (err) {
      setCheckStatus(errorText(err))
      return false
    } finally {
      setBusy((b) => ({ ...b, [id]: null }))
      pluginsApi.reload()
    }
  }

  // One at a time: each install swaps a folder and reloads the plugin list.
  async function updateAll() {
    const ids = Object.keys(updates).filter((id) => updates[id])
    let failed = 0
    for (const id of ids) if (!(await run(id, 'Updating', () => store.install(id)))) failed++
    setCheckStatus(failed ? `${failed} of ${ids.length} updates failed.` : `Updated ${ids.length} plugin${ids.length === 1 ? '' : 's'}.`)
  }

  const pendingUpdates = Object.values(updates).filter(Boolean).length

  return (
    <>
      <h3 className="settings-page-heading">Community plugins</h3>
      <SettingItem
        name="Restricted mode"
        description="While on, only official plugins from Noctívago load. Turn it off to install and use plugins made by other people."
      >
        <Toggle checked={restrictedMode} label="Restricted mode" onChange={onRestrictedChange} />
      </SettingItem>
      {confirmingUnrestrict && (
        <div className="plugin-store-confirm">
          <p>Plugins made by other people can use everything Noctívago can, including your files. Only install ones you trust.</p>
          <button className="btn btn-small btn-danger" type="button" onClick={() => { setConfirmingUnrestrict(false); pluginsApi.setRestrictedMode(false) }}>
            Turn off Restricted mode
          </button>{' '}
          <button className="btn btn-small" type="button" onClick={() => setConfirmingUnrestrict(false)}>Cancel</button>
        </div>
      )}
      <SettingItem name="Community plugins" description="Find and install plugins.">
        <button className="btn btn-primary" type="button" onClick={() => setBrowsing(true)}>Browse</button>
      </SettingItem>
      <SettingItem name="Check for updates" description={checkStatus || undefined}>
        {pendingUpdates > 0 && (
          <button className="btn btn-primary" type="button" onClick={updateAll}>Update all</button>
        )}{' '}
        <button className="btn" type="button" disabled={!plugins.length} onClick={checkForUpdates}>Check for updates</button>
      </SettingItem>

      <h3 className="settings-page-heading">Installed plugins</h3>
      {plugins.length === 0 ? (
        <p className="settings-page-hint">No community plugins installed yet.</p>
      ) : (
        <ul className="settings-plugin-list">
          {plugins.map((p) => (
            <PluginRow
              key={p.id}
              plugin={p}
              busy={busy[p.id]}
              hasOptions={p.loaded && optionPageIds.has(p.id)}
              onOpenOptions={() => onOpenOptions(p.id)}
              onToggle={(on) => pluginsApi.setEnabled(p.id, on)}
              onUninstall={() => run(p.id, 'Removing', () => store.uninstall(p.id))}
              update={updates[p.id] && { version: updates[p.id], onClick: () => run(p.id, 'Updating', () => store.install(p.id)) }}
            />
          ))}
        </ul>
      )}

      {browsing && (
        <BrowseModal
          store={store}
          restrictedMode={restrictedMode}
          described={allPlugins}
          optionPageIds={optionPageIds}
          onToggle={pluginsApi.setEnabled}
          onOpenOptions={(id) => { setBrowsing(false); onOpenOptions(id) }}
          onChanged={() => { pluginsApi.markChanged(); pluginsApi.reload() }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
