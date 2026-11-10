import { useEffect, useState } from 'react'
import { MockIcon } from '../../components/mockIcons.jsx'
import { openWhatsNewModal } from '../../core/UpdateModal.js'
import { Group } from './Group.jsx'
import { SettingItem } from './SettingItem.jsx'

const SOURCE_URL = 'https://github.com/Venari-Hunt/Noctivago'

export function AboutPage({ autoUpdate }) {
  const [version, setVersion] = useState('')
  useEffect(() => {
    autoUpdate.getState().then((s) => setVersion(s.currentVersion))
  }, [autoUpdate])

  return (
    <>
      <section className="card abouth">
        <MockIcon name="moon" size={32} />
        <h2>Noctívago</h2>
        <p>{version ? `Version ${version}. ` : ''}Ambient sound mixer for Windows, open source.</p>
      </section>
      <Group title="Project">
        <SettingItem name="Made by" description="Venari" />
        <SettingItem name="What's new" description="Full release notes">
          <button className="btn" type="button" onClick={openWhatsNewModal}>Open</button>
        </SettingItem>
        <SettingItem name="Source code" description="GitHub">
          <a className="btn" href={SOURCE_URL} target="_blank" rel="noreferrer">Open</a>
        </SettingItem>
      </Group>
    </>
  )
}
