import { useCallback, useEffect, useState } from 'react'
import { openWatchFolderPicker } from '../../core/WatchFolderDialog.js'
import { MockIcon } from '../../components/mockIcons.jsx'

function folderName(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : path
}

export function WatchedFolders({ library }) {
  const [folders, setFolders] = useState([])
  const [status, setStatus] = useState('')

  const refresh = useCallback(() => library.listWatchedFolders().then(setFolders), [library])

  useEffect(() => {
    refresh()
    // Fires after an add from either entry point (here or the toolbar "+").
    function onAdded({ detail }) {
      refresh()
      setStatus(detail.addedCount > 0 ? `Now watching. Imported ${detail.addedCount} sound${detail.addedCount === 1 ? '' : 's'}.` : 'Now watching this folder.')
    }
    document.addEventListener('watched-folder-added', onAdded)
    return () => document.removeEventListener('watched-folder-added', onAdded)
  }, [refresh])

  async function remove(id) {
    await library.removeWatchedFolder(id)
    setStatus('')
    refresh()
  }

  return (
    <>
      {folders.length === 0 ? (
        <p className="wf-empty">No folders yet. Add one, and new audio files dropped into it show up in your library.</p>
      ) : (
        <ul className="wf-list">
          {folders.map((folder) => {
            const missing = folder.status === 'missing'
            const name = folderName(folder.path)
            return (
              <li key={folder.id} className={`wf-row${missing ? ' wf-missing' : ''}`}>
                <span className="wf-icon"><MockIcon name={missing ? 'triangle-alert' : 'folder'} size={20} /></span>
                <span className="wf-text">
                  <span className="wf-name">{name}</span>
                  <span className="wf-path" title={folder.path}>{missing ? `Folder not found · ${folder.path}` : folder.path}</span>
                </span>
                <button className="wf-remove" type="button" title="Stop watching this folder" aria-label={`Stop watching ${name}`} onClick={() => remove(folder.id)}>
                  <MockIcon name="x" size={16} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="settings-row wf-add">
        <button className="btn" type="button" onClick={openWatchFolderPicker}><MockIcon name="plus" size={16} /> Add folder…</button>
        <span className="settings-check-status" role="status">{status}</span>
      </div>
    </>
  )
}
