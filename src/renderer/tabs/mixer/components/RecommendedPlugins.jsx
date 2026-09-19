import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { recommendedPlugins, installPlugins } from '../domain/recommendedPlugins.js'
import { errorText } from '../../../settings/domain/errorText.js'

// One-time card at the top of the Mixer: the app starts with only the Mixer,
// and this offers the official plugins in one click. Closing it (or
// installing) hides it for good; Settings > Community plugins > Browse has
// them afterwards.
export function RecommendedPlugins({ api }) {
  const [offered, setOffered] = useState([])
  const [chosen, setChosen] = useState(new Set())
  const [phase, setPhase] = useState('pick') // pick | installing | done | closed
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    recommendedPlugins(api)
      .then((list) => {
        setOffered(list)
        setChosen(new Set(list.map((p) => p.id)))
      })
      .catch((err) => console.error('Recommended plugins: check failed', err))
  }, [api])

  if (!offered.length || phase === 'closed') return null

  function toggle(id) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  function close() {
    api.plugins.dismissRecommended()
    setPhase('closed')
  }

  async function install() {
    setPhase('installing')
    const res = await installPlugins(api, [...chosen], setProgress)
    setResult(res)
    setPhase('done')
    if (res.installed.length) api.plugins.dismissRecommended()
  }

  return (
    <section className="recommended-plugins" aria-label="Recommended plugins">
      <div className="recommended-plugins-head">
        <h2>Add the extras</h2>
        {phase !== 'installing' && (
          <button type="button" className="recommended-plugins-close" aria-label="Close" title="Close" onClick={close}>
            ×
          </button>
        )}
      </div>

      {phase === 'pick' && (
        <>
          <p className="recommended-plugins-intro">
            Noctívago starts with just the Mixer. These free plugins add the rest, and you can remove any of them later in Settings.
          </p>
          <ul className="recommended-plugins-list">
            {offered.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="recommended-plugins-name">{p.name}</span>
                  <span className="recommended-plugins-desc">{p.description}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="recommended-plugins-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={!chosen.size} onClick={install}>
              Install {chosen.size === offered.length ? 'all' : `${chosen.size} selected`}
            </button>
            <button type="button" className="btn btn-small" onClick={close}>
              Not now
            </button>
          </div>
        </>
      )}

      {phase === 'installing' && progress && (
        <p className="recommended-plugins-intro">
          Installing {progress.plugin.name} ({progress.index + 1} of {progress.total})…
        </p>
      )}

      {phase === 'done' && result && (
        <>
          {result.installed.length > 0 && (
            <p className="recommended-plugins-intro">Installed. Restart Noctívago to load {result.installed.length === 1 ? 'it' : 'them'}.</p>
          )}
          {result.failed.map((f) => (
            <p key={f.id} className="recommended-plugins-error">
              {f.name} didn't install: {errorText(f.error)}
            </p>
          ))}
          {result.failed.length > 0 && (
            <p className="recommended-plugins-intro">You can try again from Settings &gt; Community plugins &gt; Browse.</p>
          )}
          <div className="recommended-plugins-actions">
            {result.installed.length > 0 && (
              <button type="button" className="btn btn-primary btn-small" onClick={() => api.pluginStore.restartApp()}>
                Restart now
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={close}>
              {result.installed.length > 0 ? 'Later' : 'Close'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export function mountRecommendedPlugins(container, api) {
  createRoot(container).render(<RecommendedPlugins api={api} />)
}
