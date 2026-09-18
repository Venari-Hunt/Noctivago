// Example React plugin. The source lives in src/; `npm run build:plugins`
// bundles it (React included) into ../main.js, which is what the manifest
// points at and what the app actually loads over plugin://.
//
// The plugin contract itself is framework-free: the tab hands over a plain
// DOM container, and the plugin decides what renders into it. Here that's a
// React root, created on mount.
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'

function HelloReact({ noctivago }) {
  const [clicks, setClicks] = useState(0)
  const [soundCount, setSoundCount] = useState(null)

  useEffect(() => {
    noctivago.library
      .list()
      .then((sounds) => setSoundCount(sounds.length))
      .catch(() => setSoundCount(null))
  }, [noctivago])

  return (
    <div style={{ padding: 16 }}>
      <h2>Hello from a React plugin!</h2>
      <p>
        Your library has {soundCount ?? '…'} sound{soundCount === 1 ? '' : 's'}.
      </p>
      <button onClick={() => setClicks((c) => c + 1)}>Clicked {clicks} times</button>
    </div>
  )
}

export default class HelloReactPlugin {
  /**
   * @param {import('../../../types/plugin').PluginApp} app
   * @param {import('../../../types/plugin').PluginManifest} manifest
   */
  constructor(app, manifest) {
    this.app = app
    this.manifest = manifest
    this.root = null
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'hello-react',
      title: 'Hello React',
      mount: (container) => {
        this.root = createRoot(container)
        this.root.render(<HelloReact noctivago={this.app.noctivago} />)
      }
    })
  }

  async onunload() {
    this.root?.unmount()
    this.unregister?.()
  }
}
