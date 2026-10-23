# Hello World plugin

Minimal example plugin that proves the plugin pipeline works end-to-end. It is a developer fixture only — not shipped in release builds.

For the full architecture (loading, security split, Remix as a real plugin), see [`docs/plugins.md`](../../docs/plugins.md).

## Layout

```
plugins/hello-world/
  manifest.json   # plugin metadata
  index.js        # default-export class (renderer entry)
```

## `manifest.json` fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | yes | Unique id; also the folder name under `plugins/` |
| `name` | yes | Human-readable label |
| `version` | yes | Semver string |
| `main` | yes | Renderer entry file (ES module) |
| `mainProcess` | no | Optional main-process module for trusted Node work |

This example also sets `minAppVersion`, `description`, and `author` for clarity.

## Plugin class

`index.js` default-exports a class with:

- `constructor(app, manifest)` — keep references to `app` / `manifest`
- `async onload()` — register UI (tabs, etc.)
- `async onunload()` — tear down (call the unregister function from `register`)

Register a tab with:

```js
this.unregister = this.app.tabs.register({
  id: 'hello-world',
  title: 'Hello',
  mount: (container) => {
    container.innerHTML = '<p>Hello from a plugin!</p>'
  }
})
```

`mount(container)` receives a DOM node owned by the tab host. Call `this.unregister?.()` from `onunload()` so the tab goes away cleanly.

## Where plugins live

- **Bundled / repo examples:** `plugins/<id>/` at the repo root
- **User installs:** `<userData>/plugins/<id>/`

On an id collision, the bundled plugin wins.

## Import rule

A plugin may only import files **inside its own folder**. Relative imports between its own modules work via the `plugin://<id>/…` protocol; reaching outside the plugin directory is not allowed.

## Keeping examples out of releases

When you add another example or test-fixture plugin, also exclude it in `electron-builder.yml` under `extraResources` → `plugins` → `filter` (same pattern as `!hello-world/**` and `!broken-plugin-example/**`).
