import { Group } from './Group.jsx'
import { SettingItem } from './SettingItem.jsx'

// What the app sends where: no account and no analytics, and these are the
// only places it goes online.
export function PrivacyPage() {
  return (
    <>
      <Group title="What stays and what leaves">
        <p className="prose">
          Your sounds, presets, settings and logs stay on this PC. Noctívago has no account, no analytics and no crash reports. It only
          goes online when you use Freesound, import from a link, open Community, browse plugins, or check for updates.
        </p>
      </Group>
      <Group title="Online features">
        <SettingItem name="Freesound" description="Sends what you type to freesound.org when you search, and fetches the sounds you preview or add." />
        <SettingItem name="Import from a link" description="yt-dlp asks the site for the audio you pick (YouTube or another link) and downloads it." />
        <SettingItem
          name="Community presets"
          description="Browsing and downloading send no personal data. Uploads are public. Your uploads and My presets send a random key made on this PC, and uploads send your author name."
        />
        <SettingItem name="Plugins and updates" description="Checks GitHub for the plugin list, plugin updates and new versions, and downloads the ones you install." />
      </Group>
      <Group title="Logs and bug reports">
        <SettingItem
          name="Copy logs and Report a bug"
          description="Logs are kept on this PC. Copy logs only copies them to your clipboard. Report a bug opens a GitHub issue with versions and the end of the log, and sends it only if you submit."
        />
      </Group>
    </>
  )
}
