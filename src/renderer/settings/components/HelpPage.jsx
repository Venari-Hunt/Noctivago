import { MockIcon } from '../../components/mockIcons.jsx'
import { SHORTCUTS } from '../../core/shortcuts.js'
import { Group } from './Group.jsx'
import { SettingItem } from './SettingItem.jsx'

const DOCS_URL = 'https://venari-hunt.github.io/noctivago-docs/'

// Settings > Help: the keyboard shortcuts (read from core/shortcuts.js, the
// same table the keymap uses) and where to learn more.
export function HelpPage() {
  return (
    <>
      <Group title="Keyboard">
        {SHORTCUTS.map((s) => (
          <SettingItem key={s.id} name={s.title}>
            {s.keys.map((k) => (
              <span key={k} className="kbd">{k}</span>
            ))}
          </SettingItem>
        ))}
        <SettingItem name="Change volume" description="Click a knob, then scroll. Side-scroll works over a card">
          <span className="kbd">Wheel</span>
        </SettingItem>
      </Group>
      <Group title="Learn">
        <SettingItem name="How it works" description="Short guide on the docs site">
          <a className="btn btn-svg-icon" href={DOCS_URL} target="_blank" rel="noreferrer" aria-label="Open the guide" title="Open the guide">
            <MockIcon name="external-link" />
          </a>
        </SettingItem>
      </Group>
    </>
  )
}
