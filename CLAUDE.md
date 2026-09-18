# Noctívago

Windows ambient sound mixer. Electron + React (older screens still plain JS/DOM). Every screen = `domain/` (rules, no DOM) + `components/` (small React components). Conventions and build/run: `CONTRIBUTING.md`.

## Architecture

- `src/main/` — main process.
  - `index.js` — window, `sound://` (original file or baked loop clip) and `plugin://` protocols. In dev with 2+ displays, opens on the highest-numbered one (`devWindowPosition()`).
  - `ipc.js` IPC handlers · `library.js` sounds (electron-store) · `presets.js` saved mixes.
  - `ffmpeg/` — `runFfmpeg.js` spawn wrapper, `ffmpegPath.js`, `loopClip.js`, `waveformPeaks.js`, `exportMix.js`.
  - `plugins/` — `registry.js` manifests, `protocol.js` path guard, `invoke.js` plugin main-process calls, `store.js` plugin store.
- `src/preload/index.js` — `window.noctivago` (`library`, `presets`, `audio`, `plugins`, `pluginStore`).
- `src/shared/` — code/constants used by main and renderer.
- `src/renderer/` — `main.js` bootstrap; `core/TabHost.js`, `core/PluginLoader.js`; `tabs/mixer/` the Mixer; `audio/` engine, sources, clip meters; `ui/` Mixer-only widgets.
- `plugins/<id>/` — Remix (`editor/`), Export, Composite, Browse Sounds, Community, plugin store.

## Docs (read only the one a task touches)

- `docs/playback.md` — stream/buffer playback, crossfades, scatter/scheduled, waveforms, clip meters, why ffmpeg.
- `docs/plugins.md` — plugin architecture, React build, store, Remix.
- `docs/presets.md` — per-preset sound overrides.
- `docs/freesound-and-browse.md` — Freesound + Browse Sounds.
- `docs/community-presets.md` — Cloudflare backend, `.ncvpreset`.
- `docs/watch-folders.md` — watched-folder import.
- `docs/releasing.md` — releases, auto-update, itch.io.
- `CHANGELOG.md` — dated release history (what exists). Old version numbers in docs are provenance, not things to re-verify.

**Doc site:** `Venari-Hunt/noctivago-docs` (plain HTML, push to `main`). Update it whenever possible: any user-facing change updates its page, and each release updates What's new (`node tools/build-changelog.mjs <this repo>/CHANGELOG.md`) before the tag. Batch only if it's truly expensive, and never past the next major release.
