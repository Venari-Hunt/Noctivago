import { useCallback, useEffect, useState } from 'react'
import { openWatchFolderPicker } from '../../core/WatchFolderDialog.js'

export function WatchedFolders({ library }) {
  const [folders, setFolders] = useState([])
  const [status, setStatus] = useState('')

  const refresh = useCallback(() => library.listWatchedFolders().then(setFolders), [library])

  useEffect(() => {
    refresh()
    // Fires after an add from either entry point (here or the toolbar "+").
    function onAdded({ detail }) {
      refresh()
      setStatus(detail.addedCount > 0 ? `Watching folder — imported ${detail.addedCount} sound${detail.addedCount === 1 ? '' : 's'}.` : 'Watching folder.')
    }
    document.addEventListener('watched-folder-added', onAdded)
    return () => document.removeEventListener('watched-folder-added', onAdded)
  }, [refresh])

  async function remove(id) {
    await library.removeWatchedFolder(id)
    refresh()
  }

  return (
    <>
      <ul className="preset-list watched-folder-list">
        {folders.length === 0 ? (
          <li className="preset-list-empty">No watched folders yet.</li>
        ) : (
          folders.map((folder) => (
            <li key={folder.id} className="preset-row">
              <span className={`preset-row-name${folder.status === 'missing' ? ' watched-folder-missing' : ''}`}>
                {folder.status === 'missing' ? `${folder.path} (not found)` : folder.path}
              </span>
              <button className="btn btn-small btn-danger" type="button" onClick={() => remove(folder.id)}>Stop watching</button>
            </li>
          ))
        )}
      </ul>
      <div className="settings-row">
        <button className="btn" type="button" onClick={openWatchFolderPicker}>Add watched folder…</button>
        <span className="settings-check-status">{status}</span>
      </div>
    </>
  )
}
