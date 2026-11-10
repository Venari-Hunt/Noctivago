import { useEffect } from 'react'
import { PluginOptionsPage } from './PluginOptionsPage.jsx'

// A plugin's own settings, opened from its Options button (the mock's
// "Plugin options" dialog).
export function PluginOptionsDialog({ title, page, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card settings-options-dialog" role="dialog" aria-label={`${title} options`}>
        <div className="settings-page-top">
          <h2>{title} options</h2>
          <button className="btn btn-icon" type="button" title="Close" onClick={onClose}>✕</button>
        </div>
        <PluginOptionsPage page={page} />
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
