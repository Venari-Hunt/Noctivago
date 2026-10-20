import { useEffect, useState } from 'react'
import { SettingItem } from './SettingItem.jsx'
import { compressView } from '../domain/compressText.js'

export function CompressSounds({ library, restartApp }) {
  const [info, setInfo] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    library.compressionInfo().then(setInfo)
    return library.onCompressSoundsProgress(setProgress)
  }, [library])

  async function start() {
    setProgress({ done: 0, total: info.count })
    const done = await library.compressSounds()
    setProgress(null)
    setResult(done)
    setInfo(await library.compressionInfo())
  }

  const view = compressView({ info, progress, result })
  return (
    <SettingItem
      name="Compress library sounds"
      description="Converts WAV sounds stored in your library to FLAC: the same sound, about half the space. Sounds you play from their own folder are never touched. The change finishes the next time Noctívago starts."
    >
      <div className="settings-row">
        <span className="settings-check-status">{view.status}</span>
        {view.canStart && <button className="btn" type="button" onClick={start}>Compress</button>}
        {view.canRestart && <button className="btn" type="button" onClick={restartApp}>Restart now</button>}
      </div>
    </SettingItem>
  )
}
