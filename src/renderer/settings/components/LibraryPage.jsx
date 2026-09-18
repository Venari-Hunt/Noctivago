import { SettingItem } from './SettingItem.jsx'
import { Toggle } from './Toggle.jsx'
import { WatchedFolders } from './WatchedFolders.jsx'

const COOKIE_BROWSERS = [
  ['none', "Don't sign in"],
  ['chrome', 'Chrome'],
  ['edge', 'Edge'],
  ['firefox', 'Firefox'],
  ['brave', 'Brave']
]

export function LibraryPage({ settings, api }) {
  return (
    <>
      <h3 className="settings-page-heading">Adding sounds</h3>
      <SettingItem name="Prepare seamless looping on add" description="Bake the loop as soon as a sound is added, instead of waiting until it's first played.">
        <Toggle checked={settings.eagerlyBakeOnImport} label="Prepare seamless looping on add" onChange={(v) => api.update((s) => s.setEagerlyBakeOnImportEnabled(v))} />
      </SettingItem>
      <SettingItem
        name="YouTube/video downloads: sign in as"
        description="YouTube blocks anonymous downloads. Picking a browser lets “Add from link” use that browser's YouTube sign-in. It reads cookies only, never your password, and you must already be signed in to YouTube there."
      >
        <select value={settings.ytDlpCookiesBrowser ?? 'none'} onChange={(e) => api.update((s) => s.setYtDlpCookiesBrowser(e.target.value))}>
          {COOKIE_BROWSERS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </SettingItem>

      <h3 className="settings-page-heading">Watched folders</h3>
      <p className="settings-page-hint">Audio files added to these folders later are imported into your library automatically.</p>
      <WatchedFolders library={api.library} />
    </>
  )
}
