import { useState } from 'react'
import { Group } from './Group.jsx'
import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'

// Tools for finding out what went wrong: DevTools, the log, a prefilled bug report.
export function AdvancedPage({ settings, api, troubleshooting }) {
  const [copied, setCopied] = useState(false)

  async function copyLogs() {
    await troubleshooting.copyLogs()
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <Group title="Troubleshooting">
      <SettingItem name="Developer tools" description="Press Ctrl+Shift+I to open them. Only needed when asked, or to look at errors yourself.">
        <Toggle checked={settings.developerTools} label="Developer tools" onChange={(v) => api.update((s) => s.setDeveloperToolsEnabled(v))} />
      </SettingItem>
      <SettingItem name="Copy logs" description="The last 200 lines of the log plus the app and plugin versions, ready to paste.">
        <button className="btn" type="button" onClick={copyLogs}>{copied ? 'Copied' : 'Copy'}</button>
      </SettingItem>
      <SettingItem name="Report a bug" description="Opens a GitHub issue with the versions and the end of the log filled in. You review it before sending.">
        <button className="btn" type="button" onClick={() => troubleshooting.reportBug()}>Open</button>
      </SettingItem>
    </Group>
  )
}
