import { useEffect, useMemo } from 'react'
import notices from '../../../../THIRD_PARTY_NOTICES.md?raw'
import { parseNotices } from '../domain/licenses.js'
import { Markdown } from './Markdown.jsx'

// About > Licenses: the third-party software Noctívago ships with, read from
// THIRD_PARTY_NOTICES.md at build time.
export function LicensesDialog({ onClose }) {
  const entries = useMemo(() => parseNotices(notices), [])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card settings-options-dialog" role="dialog" aria-label="Licenses">
        <div className="settings-page-top">
          <h2>Licenses</h2>
          <button className="btn btn-icon" type="button" title="Close" onClick={onClose}>✕</button>
        </div>
        {entries.map((e) => (
          <section key={e.name} className="license-entry" aria-label={e.name}>
            <h3>{e.name}</h3>
            <p className="prose">{[e.license, e.source].filter(Boolean).join(' · ')}</p>
            <Markdown source={e.body} />
          </section>
        ))}
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
