import { Group } from './Group.jsx'
import { SettingItem } from './SettingItem.jsx'

// What the app sends where: no account and no analytics, and these are the
// only places it goes online.
export function PrivacyPage() {
  return (
    <>
      <Group title="What stays and what leaves">
        <p className="prose">
          Your sounds, presets and settings stay on this PC. Noctívago has no account and no analytics. It only goes online when you
          search Freesound or YouTube, open Community, browse plugins, or check for updates.
        </p>
      </Group>
      <Group title="Online features">
        <SettingItem name="Freesound search" description="Sends what you type to freesound.org." />
        <SettingItem name="YouTube import" description="yt-dlp asks YouTube for the video you pick." />
        <SettingItem name="Community presets" description="Your uploads are public. Sends only what you upload." />
        <SettingItem name="Plugins and updates" description="Checks GitHub for the plugin list, plugin updates and new versions." />
      </Group>
    </>
  )
}
