import { useEffect, useState } from 'react'
import { parseDuration } from '../../util/time.js'
import { formatHms } from '../domain/formatHms.js'
import { openUpdateModal, openWhatsNewModal } from '../../core/UpdateModal.js'
import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'

export function GeneralPage({ settings, api }) {
  const [interval, setIntervalText] = useState(formatHms(settings.autoUpdateIntervalSeconds))

  useEffect(() => setIntervalText(formatHms(settings.autoUpdateIntervalSeconds)), [settings.autoUpdateIntervalSeconds])

  // Commits on blur/Enter, not on every keystroke - a half-typed "hh:mm:ss"
  // shouldn't get saved or reformatted mid-entry. An unparseable or
  // non-positive value reverts to what's still persisted.
  function commitInterval() {
    const seconds = parseDuration(interval)
    if (seconds != null && seconds > 0) api.update((s) => s.setAutoUpdateIntervalSeconds(seconds))
    else setIntervalText(formatHms(settings.autoUpdateIntervalSeconds))
  }

  return (
    <>
      <h3 className="settings-page-heading">Updates</h3>
      <SettingItem name="Check for updates">
        <button className="btn" type="button" onClick={openUpdateModal}>Check now…</button>
        <button className="btn" type="button" onClick={openWhatsNewModal}>What's new</button>
      </SettingItem>
      <SettingItem name="Automatically check for updates">
        <Toggle checked={settings.autoUpdateEnabled} label="Automatically check for updates" onChange={(v) => api.update((s) => s.setAutoUpdateEnabled(v))} />
      </SettingItem>
      <SettingItem name="Check every" description="hh:mm:ss">
        <input
          type="text"
          inputMode="numeric"
          placeholder="hh:mm:ss"
          className="settings-interval-input"
          value={interval}
          onChange={(e) => setIntervalText(e.target.value)}
          onBlur={commitInterval}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </SettingItem>
      <SettingItem
        name="Install updates automatically"
        description="Download, install and restart when an update is found, after a 5-second countdown you can cancel."
      >
        <Toggle checked={settings.autoInstallUpdates} label="Install updates automatically" onChange={(v) => api.update((s) => s.setAutoInstallUpdatesEnabled(v))} />
      </SettingItem>

      <h3 className="settings-page-heading">Window</h3>
      <SettingItem
        name="Keep playing when closed"
        description="Closing minimizes to the system tray instead of quitting. Click the tray icon to bring the window back; right-click it for play/pause and quit."
      >
        <Toggle checked={settings.minimizeToTrayEnabled} label="Keep playing when closed" onChange={(v) => api.update((s) => s.setMinimizeToTrayEnabled(v))} />
      </SettingItem>
    </>
  )
}
