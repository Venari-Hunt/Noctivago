// The JSDoc types below point at the plugin contract (types/plugin.d.ts), so
// an editor gives autocomplete for app.tabs / app.noctivago here.
export default class HelloWorldPlugin {
  /**
   * @param {import('../../types/plugin').PluginApp} app
   * @param {import('../../types/plugin').PluginManifest} manifest
   */
  constructor(app, manifest) {
    this.app = app
    this.manifest = manifest
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'hello-world',
      title: 'Hello',
      mount: (container) => {
        container.innerHTML = `
          <div style="padding: 16px;">
            <h2>Hello from a plugin!</h2>
            <p>This tab was registered by a plugin loaded via <code>plugin://hello-world/index.js</code>, proving the full pipeline: manifest discovery, the plugin:// protocol, dynamic import, and tab registration.</p>
          </div>
        `
      }
    })
  }

  async onunload() {
    this.unregister?.()
  }
}
