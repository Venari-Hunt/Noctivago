import { useEffect, useState } from 'react'
import { parseDuration } from '../../util/time.js'
import { formatHms } from '../domain/formatHms.js'
import { openUpdateModal, openWhatsNewModal } from '../../core/UpdateModal.js'
import { getAudioOutputChoice, listAudioOutputs, setAudioOutputChoice } from '../../core/devAudioOutput.js'
import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'
import { Group } from './Group.jsx'

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
      <Group title="Appearance">
        <SettingItem name="Presets open as" description="Rail keeps the Mixer in view. Gallery opens a window over it.">
          <div className="preset-view-seg" role="group" aria-label="Presets open as">
            <button type="button" aria-pressed={settings.presetsView !== 'gallery'} onClick={() => api.update((s) => s.setPresetsView('rail'))}>Rail</button>
            <button type="button" aria-pressed={settings.presetsView === 'gallery'} onClick={() => api.update((s) => s.setPresetsView('gallery'))}>Gallery</button>
          </div>
        </SettingItem>
      </Group>

      <Group title="Updates">
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
      </Group>

      <Group title="Audio">
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
      </Group>

      <Group title="Window">
        <SettingItem
          name="Keep playing when closed"
          description="Closing minimizes to the system tray instead of quitting. Click the tray icon to bring the window back; right-click it for play/pause and quit."
        >
          <Toggle checked={settings.minimizeToTrayEnabled} label="Keep playing when closed" onChange={(v) => api.update((s) => s.setMinimizeToTrayEnabled(v))} />
        </SettingItem>
      </Group>
    </>
  )
}
