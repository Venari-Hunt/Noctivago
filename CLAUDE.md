# Noctívago

Windows desktop ambient sound mixer. Electron + vanilla JS/DOM (no UI framework).

See `CONTRIBUTING.md` for build/run instructions and code conventions if you're working on the codebase.

## Architecture

- `src/main/` — Electron main process.
  - `index.js` — window creation, custom `sound://` protocol (serves either the original file or a rendered loop clip, see docs/playback.md) and `plugin://` protocol (serves plugin files, see docs/plugins.md). Under `npm run dev` with more than one display connected, `devWindowPosition()` opens the dev window on the highest-numbered display rather than the default (primary, centered) position, so a dev session doesn't pop a window over whatever's already in use on the primary display — computed *before* window creation (passed as `x`/`y` to the `BrowserWindow` constructor) rather than moved after the fact, to avoid a visible flash on the primary display first. Gated on `!app.isPackaged`, so a real installed build is never affected.
  - `ipc.js` — IPC handlers.
  - `library.js` — registered sound files, persisted via `electron-store`.
  - `presets.js` — saved mixes.
  - `ffmpeg/` — ffmpeg integration (see docs/playback.md). `runFfmpeg.js` is the reusable spawn wrapper; `ffmpegPath.js` resolves the bundled binary; `loopClip.js` and `waveformPeaks.js` are its two current consumers.
  - `plugins/` — `registry.js` (scans + caches bundled/user plugin manifests), `protocol.js` (`plugin://` handler + path-traversal guard), `invoke.js` (dispatches `plugin:invoke` IPC to a plugin's own main-process module).
- `src/preload/index.js` — contextBridge API exposed to the renderer as `window.noctivago` (namespaces: `library`, `presets`, `audio`, `plugins`).
- `src/shared/constants.js` — plain constants imported by both main and renderer (e.g. `MAX_BUFFER_CLIP_SECONDS`).
- `src/renderer/` — plain JS/DOM UI, no framework.
  - `core/TabHost.js` — tab bar + lazily-mounted `<section>` per tab.
  - `core/PluginLoader.js` — discovers plugins via IPC, dynamically `import()`s each one, registers its tab(s).
  - `tabs/mixer/index.js` — the entire sound mixer, registered as the first tab via `mount(container)`.
  - `audio/AudioEngine.js`, `audio/SoundSource.js` (streaming playback), `audio/BufferSoundSource.js` (buffer/gapless playback).
  - `ui/*.js` — SoundList, SoundRow, PresetsModal (mixer-specific, used only by `tabs/mixer/`).
  - `main.js` — a tiny bootstrap: creates the `TabHost`, registers the Mixer tab synchronously, then calls `loadPlugins()`.

## Documentation map

This file is loaded automatically into every session, so it stays short on purpose. Everything else lives in `docs/` — read the specific file on demand when a task actually touches that area, not preemptively:

- `docs/playback.md` — stream vs. buffer playback, loop crossfades, scatter/scheduled one-shot randomization, waveform peaks + canvas rendering, why ffmpeg (not more JS), the app icon build.
- `docs/plugins.md` — the plugin architecture (manifest shape, `plugin://` loading, main/renderer trust split) and the Remix plugin (trim/filters/EQ/Doppler/Speed-Pitch/Fluctuation/pan/loop-seam editing, its Sound/Preset/Group modes, bus processing).
- `docs/presets.md` — per-preset sound overrides (`OVERRIDABLE_SOUND_KEYS`, the merge logic, default-preset bootstrapping).
- `docs/freesound-and-browse.md` — Freesound API auth/import and the Browse Sounds plugin (Freesound + YouTube search, per-source toggles, sticky preview bar).
- `docs/community-presets.md` — the community preset-sharing backend (Cloudflare Worker/D1/R2) and the `.ncvpreset` transfer format.
- `docs/watch-folders.md` — auto-import from watched folders, recursive subfolder tagging.
- `docs/releasing.md` — `npm run release:win`, GitHub Releases, in-app auto-update, itch.io.

`CHANGELOG.md` is the dated release history. The `docs/` files describe current architecture and why it's shaped that way, not a log of how it got there — when a doc references an old version number, that's provenance for a design decision, not something that needs re-verifying.

## Status

Noctívago implements: a mix/preset model (per-sound "include in mix" toggle, global play/pause, global volume, per-preset sound overrides), the ffmpeg-based buffer-mode/waveform system (with an automatic self-crossfade on every baked loop clip), Opus/mp3/wav/ogg/flac/m4a format support, a plugin architecture (tab shell, `plugin://` loading, fail-soft per-plugin loading), the Remix plugin (trim, filters, parametric EQ, Doppler, Speed/Pitch/Reverse, scatter/scheduled randomization, Fluctuation, Volume envelope, Noise gate/reduction, whole-mix and Sound Group bus processing with occlusion), export/rendering to a file, in-app rename, an app-wide double-click-resets-any-slider convention, a dedicated Browse Sounds tab for Freesound search/preview/import with attribution (more sources planned), and CI-built installers with in-app update checking.

See `CHANGELOG.md` for the detailed, dated release history.
