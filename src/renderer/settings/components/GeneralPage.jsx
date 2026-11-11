import { useEffect, useState } from 'react'
import { parseDuration } from '../../util/time.js'
import { formatHms } from '../domain/formatHms.js'
import { openUpdateModal, openWhatsNewModal } from '../../core/UpdateModal.js'
import { getAudioOutputChoice, listAudioOutputs, setAudioOutputChoice } from '../../core/devAudioOutput.js'
import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'

export function GeneralPage({ settings, api }) {
  const [interval, setIntervalText] = useState(formatHms(settings.autoUpdateIntervalSeconds))

  const [output, setOutput] = useState(getAudioOutputChoice())
  const [outputs, setOutputs] = useState([])
  useEffect(() => {
    listAudioOutputs().then(setOutputs)
  }, [])
  function chooseOutput(choice) {
    setOutput(choice)
    setAudioOutputChoice(choice)
  }

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
      <SettingItem
        name="Update channel"
        description={
          settings.updateChannel === 'nightly'
            ? 'Nightly: the newest changes, before they are released. May have bugs. Your library is backed up before each update.'
            : 'Stable: tested releases only. Switching back from Nightly installs the latest stable version and keeps your library.'
        }
      >
        <select aria-label="Update channel" value={settings.updateChannel === 'nightly' ? 'nightly' : 'stable'} onChange={(e) => api.update((s) => s.setUpdateChannel(e.target.value))}>
          <option value="stable">Stable</option>
          <option value="nightly">Nightly</option>
        </select>
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

      <h3 className="settings-page-heading">Audio</h3>
      <SettingItem
        name="Output device"
        description="Where Noctívago plays. Automatic is your system default, or the Yeti in a dev build."
      >
        <select aria-label="Output device" value={output} onChange={(e) => chooseOutput(e.target.value)}>
          <option value="auto">Automatic</option>
          <option value="default">System default</option>
          {outputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
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
