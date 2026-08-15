# Noctívago

Windows desktop ambient sound mixer, inspired by the Linux app [Blanket](https://github.com/rafaelmardojai/blanket) (not a port — Blanket is GTK/Linux-only). Electron + vanilla JS/DOM (no UI framework). Original MVP spec: `C:\Users\jluca\.claude\plans\ok-i-m-fine-with-hidden-lemur.md`.

The user (owner of this project) is not a developer — explain setup steps explicitly, don't assume familiarity with the toolchain.

## Running it

```
npm install
npm run dev
```

Two environment quirks that show up in fresh shells on this machine (both needed before `npm`/`node`/Electron will work):
- `node`/`npm` aren't reliably on `PATH` in every shell — `$env:Path += ";C:\Program Files\nodejs"` if `node -v` fails.
- If launching Electron produces `Cannot read properties of undefined (reading 'whenReady')`, an inherited `ELECTRON_RUN_AS_NODE=1` env var is forcing Electron to run as plain Node. Clear it: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

`ffmpeg-static`'s postinstall (which downloads the actual ffmpeg binary) sometimes gets skipped by npm's script-allowlist prompt — if ffmpeg-dependent features (waveform, loop clips) fail, check `node_modules/ffmpeg-static/ffmpeg.exe` exists; if not, run `node node_modules/ffmpeg-static/install.js`.

## Architecture

- `src/main/` — Electron main process.
  - `index.js` — window creation, custom `sound://` protocol (serves either the original file or a rendered loop clip, see below) and `plugin://` protocol (serves plugin files, see Plugins below).
  - `ipc.js` — IPC handlers.
  - `library.js` — registered sound files, persisted via `electron-store`.
  - `presets.js` — saved mixes.
  - `ffmpeg/` — ffmpeg integration (see below). `runFfmpeg.js` is the reusable spawn wrapper; `ffmpegPath.js` resolves the bundled binary; `loopClip.js` and `waveformPeaks.js` are its two current consumers.
  - `plugins/` — `registry.js` (scans + caches bundled/user plugin manifests), `protocol.js` (`plugin://` handler + path-traversal guard), `invoke.js` (dispatches `plugin:invoke` IPC to a plugin's own main-process module).
- `src/preload/index.js` — contextBridge API exposed to the renderer as `window.noctivago` (namespaces: `library`, `presets`, `audio`, `plugins`).
- `src/shared/constants.js` — plain constants imported by both main and renderer (e.g. `MAX_BUFFER_CLIP_SECONDS`).
- `src/renderer/` — plain JS/DOM UI, no framework.
  - `core/TabHost.js` — tab bar + lazily-mounted `<section>` per tab.
  - `core/PluginLoader.js` — discovers plugins via IPC, dynamically `import()`s each one, registers its tab(s).
  - `tabs/mixer/index.js` — the entire sound mixer (was `main.js` before the plugin-architecture rework), registered as the first tab via `mount(container)`.
  - `audio/AudioEngine.js`, `audio/SoundSource.js` (streaming playback), `audio/BufferSoundSource.js` (buffer/gapless playback).
  - `ui/*.js` — SoundList, SoundRow, PresetsModal (mixer-specific, used only by `tabs/mixer/`). Trimming/filtering UI (`LoopEditor.js`, waveform drawing) used to live here but moved to the Remix plugin — see below.
  - `main.js` — now a tiny bootstrap: creates the `TabHost`, registers the Mixer tab synchronously, then calls `loadPlugins()`.

### Playback: two modes, chosen automatically per sound

**Stream mode** (`LocalFileSoundSource`, the default): each sound plays through an `<audio>` element (`src="sound://<id>"`) piped into `MediaElementAudioSourceNode → per-sound GainNode → master GainNode`. The `sound://` protocol hand-rolls HTTP Range support via `fs.createReadStream` (Electron's `net.fetch` on `file://` URLs was found to silently ignore Range headers in this Electron version — don't assume it works, verify). Looping is a `requestAnimationFrame` boundary-check + seek-back — not sample-accurate, can have an audible click/gap at the seam. This is what makes arbitrarily long files (hours) playable at all without loading them into memory.

**Buffer mode** (`BufferSoundSource`): whenever the user trims + sets filters and hits Save in the Remix plugin (see below), ffmpeg renders *just that loop region*, with any highpass/lowpass/gain filters baked in via `-af`, out to a small WAV (`src/main/ffmpeg/loopClip.js`, `getUserData()/clips/<id>.wav`) — but only if the region is ≤ `MAX_BUFFER_CLIP_SECONDS` (600s/10min, in `src/shared/constants.js`). Since the clip is now short regardless of how long the source file was, it's fully decoded client-side (`decodeAudioData`) into a native `AudioBufferSourceNode` with true `loop=true`/`loopStart`/`loopEnd` — sample-accurate, click-free. `tabs/mixer/index.js`'s `loopClipEligible(entry)` checks `entry.loopClipReady` + that the clip's recorded loop points *and* filters still match the entry's live ones (4-way staleness check, since either changing without re-saving should fall back to streaming) before trying buffer mode, and falls back to stream mode on *any* failure (missing ffmpeg, corrupt clip, decode error) — buffer mode is strictly additive, never required for the app to work.

`BufferSoundSource.pause()` tracks elapsed offset manually (`AudioBufferSourceNode` is one-shot — can't be pause/resumed like `<audio>` can) so resuming continues from the same position rather than restarting, matching stream mode's behavior.

### Waveform

`src/main/ffmpeg/waveformPeaks.js` streams the *whole* original file through ffmpeg as downsampled mono float32 PCM and reduces it into `[min,max]` peaks per pixel column with O(1) memory (never buffers the decoded audio) — works for files of any length/format. This replaced an earlier renderer-side `decodeAudioData`-based approach that was capped at 30 minutes and fell back to a bare time-ruler beyond that.

### Why ffmpeg, not more JS

Both the loop-seam click and the waveform-for-long-files problems trace back to the same root cause: `decodeAudioData` on a whole multi-hour file either throws `EncodingError` or uses gigabytes of RAM (this is *why* stream mode exists at all — see git history around the original long-file rewrite). ffmpeg (bundled via `ffmpeg-static`, spawned via `child_process`, never a shell) processes files without holding them fully in memory, sidestepping that limit entirely. `runFfmpeg.js` is deliberately generic/domain-agnostic so ffmpeg-based features reuse it rather than each rolling their own spawn logic — the Remix plugin's filter baking (see below) is the first consumer beyond loop clips/waveforms.

**Packaging note (untested as of this writing):** `electron-builder.yml` has `asarUnpack: [node_modules/ffmpeg-static/**]` — required because binaries can't execute from inside an asar archive. Works in `npm run dev` regardless; only provable by actually running `npm run build:win` and testing the installed app.

## Plugins

The app is meant to be open-sourced with outside contributors adding functionality as plugins rather than editing core — modeled on Obsidian's plugin architecture, but **deliberately not** copying its trust model (Obsidian plugins get raw Node/Electron access; here that's split by process, see below), since this codebase has been consistently more sandboxed (`contextIsolation: true`, no `nodeIntegration`, everything served through custom protocols rather than raw file access).

**A plugin is a folder** containing `manifest.json` (`id`, `name`, `version`, `main` required; `mainProcess` optional) + a `main` entry file exporting a default class:
```js
export default class MyPlugin {
  constructor(app, manifest) { this.app = app }
  async onload() { this.unregister = this.app.tabs.register({ id, title, mount: (container) => {...} }) }
  async onunload() { this.unregister?.() }
}
```
Two real examples exist in `plugins/`: `hello-world/` (minimal working plugin) and `broken-plugin-example/` (deliberately throws in `onload()` — a regression-test fixture proving one broken plugin can't take down the app or other plugins).

**Where plugins live**: `plugins/<id>/` at the repo root for bundled/official plugins (packaged into the app via `electron-builder.yml`'s `extraResources`), and `<userData>/plugins/<id>/` for user-installed ones (parallel to Obsidian's `.obsidian/plugins/`). `src/main/plugins/registry.js` scans both and merges them; on an id collision, bundled wins. Presence in either directory *is* enabled — there's no enable/disable toggle UI in v1 (disable by moving the folder out).

**How loading actually works**: `plugin://<id>/<path>` is a privileged `standard` Electron scheme (registered in `main/index.js`, handled in `src/main/plugins/protocol.js`) serving a plugin's own files as real ES modules — `PluginLoader.js` in the renderer does `await import(\`plugin://${id}/${manifest.main}\`)`, which resolves relative imports between a plugin's own files correctly and shows real filenames/breakpoints in DevTools. This directly extends the same pattern `sound://` already established for serving local files into the sandboxed renderer. Verified working (including relative cross-file imports) via a throwaway spike before any of the rest was built.

**Security posture — split by process**:
- Renderer-side plugin code (`manifest.main`) is exactly as sandboxed as core code — no `require`, no `ipcRenderer`, only the curated `app` object (`{ tabs, noctivago, plugin }`) it's constructed with. `app.noctivago` is `window.noctivago` handed through wholesale (already curated/whitelisted) — no per-plugin capability scoping in v1, any enabled plugin can call any core API, matching Obsidian's own trust model closely enough not to need more yet.
- Main-process plugin code (`manifest.mainProcess`, opt-in) is ordinary trusted Node — same trust level `src/main/*.js` already has — loaded via `src/main/plugins/invoke.js`. This is the only place a plugin gets real power (spawn ffmpeg, touch disk), reached from the renderer via one generic `api.plugins.invoke(pluginId, method, ...args)` rather than each plugin needing its own hand-written IPC channel in `ipc.js`.
- This is not real code sandboxing — a `mainProcess` plugin still has full Node power once opted into, same as Obsidian's actual model. Trust boundary remains "the user reads/trusts plugin source before installing," just scoped to a smaller, more visible manifest field than "the whole plugin."

**Explicit non-goals for v1** (deferred, not designed): plugin marketplace/browser, hot-reload dev tooling, settings-tab API, command palette, ribbon icons, enable/disable UI, per-plugin capability scoping, persistent per-plugin data storage.

**Full design rationale** (alternatives considered and rejected, e.g. `executeJavaScript` injection vs. dynamic `import()`, why core doesn't route through the plugin loader itself) is in the plan file this was built from: `C:\Users\jluca\.claude\plans\snoopy-booping-sky.md`.

### The Remix plugin (`plugins/editor/`, tab titled "Remix")

The first real (non-toy) plugin, and the one that validated the plugin API against an actual feature. All per-sound editing — trim points *and* filters (highpass, lowpass, gain) — lives here now; it moved out of the core Mixer tab entirely (the old in-mixer Loop Editor modal, its canvas/waveform code, and the "Trim" button are gone from `src/renderer/` — deleted, not just unused, once nothing else referenced them).

- **Live preview without touching ffmpeg**: `audio/PreviewSource.js` streams the sound the same way `LocalFileSoundSource` does (`sound://<id>`, works for any file length) but inserts a `BiquadFilterNode` (highpass) → `BiquadFilterNode` (lowpass) → `GainNode` chain before the output gain. Dragging a filter slider calls `setTargetAtTime` on these nodes directly — instant, click-free, audible feedback with zero ffmpeg round-trips. ffmpeg only runs once, on Save.
- **Save bakes trim + filters in one ffmpeg pass**: reuses `loopClip.js`'s renderer (extended to accept a `filters` object and insert `-af highpass=f=…,lowpass=f=…,volume=…dB` into the ffmpeg args), rather than building a second, parallel baking pipeline. The Mixer's buffer-mode eligibility check compares filters as well as loop points, so changing either without re-saving correctly falls back to (filter-less) streaming instead of playing stale audio.
- **Self-contained by design, not by accident**: a plugin can't import files outside its own directory (enforced by the `plugin://` path-traversal guard), so `plugins/editor/` has its own copies of `AudioEngine.js`, the waveform-drawing code, `LoopEditor.js` (the drag/scrub/snap canvas controller), and `util/time.js` — duplicated from core rather than shared. This is a deliberate tradeoff matching Obsidian's "bundle your own dependencies" plugin model, not an oversight; keep it in mind if core's copies of these change and the plugin's need the same fix.
- `MAX_BUFFER_CLIP_SECONDS` (600s) is duplicated as a local constant in `plugins/editor/index.js` for the same cross-directory-import reason — keep it in sync with `src/shared/constants.js` if that value ever changes.

## Status

As of 2026-08-15: mix/preset model (per-sound "include in mix" toggle, global play/pause, global volume), the ffmpeg-based buffer-mode/waveform system, the plugin architecture (tab shell, `plugin://` loading, fail-soft per-plugin loading), and the Remix plugin (trim + highpass/lowpass/gain filters, live Web Audio preview, ffmpeg bake-on-save) are all implemented and verified in dev via CDP-driven testing — including a full regression pass of every mixer feature after relocating it into a tab module, and end-to-end verification of the Remix plugin (picker → trim/waveform → live filter preview → save/bake → Mixer picks up the baked clip), confirmed working with zero console errors across the whole flow.

**Not yet done:** a packaged-build (`npm run build:win`) smoke test — neither the ffmpeg `asarUnpack` path nor the plugins `extraResources` path can be verified any other way, so treat packaging as unverified until someone actually runs the built installer. A full FL-Studio-style parametric multi-band EQ (draggable nodes on a frequency-response curve) is a noted future enhancement to the Remix plugin, not started — current filters are 3 fixed controls (highpass/lowpass/gain).

Separately, the way sounds get added to the library is a known near-term UX gap: no "remember last folder" on the file picker, no folder-as-watch-directory or folder-as-preset options, single plain "Add Sound" button rather than a "+" with multiple add modes. Discussed but deliberately deferred until the Remix plugin work above was finished.
