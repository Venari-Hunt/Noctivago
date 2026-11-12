# Noctívago

Windows ambient sound mixer. Electron + React (older screens still plain JS/DOM). Every screen = `domain/` (rules, no DOM) + `components/` (small React components). Conventions and build/run: `CONTRIBUTING.md`.

## Architecture

- `src/main/` — main process.
  - `index.js` — window, `sound://` (original file or baked loop clip) and `plugin://` protocols. In dev with 2+ displays, opens on the highest-numbered one (`devWindowPosition()`).
  - `ipc.js` IPC handlers · `library.js` sounds (electron-store) · `presets.js` saved mixes.
  - `dataGuard.js` (second import, before any store) + `dataGuardCore.js` — data stamp, a snapshot per upgrade, restore on a downgrade across `src/shared/dataSchema.js` `DATA_SCHEMA`. **Store changes are additive** (rules: `docs/releasing.md` "Data that survives a downgrade").
  - `ffmpeg/` — `runFfmpeg.js` spawn wrapper, `ffmpegPath.js`, `loopClip.js`, `waveformPeaks.js`, `exportMix.js`.
  - `phone/` — "Export for phone": `phoneBundle.js` bakes a preset into a phone `.ncvpreset`, rules in `phoneBundleCore.js` (`docs/mobile.md`).
  - `plugins/` — `registry.js` manifests, `protocol.js` path guard, `invoke.js` plugin main-process calls, `store.js` plugin store.
- `src/preload/index.js` — `window.noctivago` (`library`, `presets`, `audio`, `plugins`, `pluginStore`).
- `src/shared/` — code/constants used by main and renderer. The playback rules the phone player also imports are here, DOM- and Electron-free: `modulator.js` (Fluctuation walk + timing), `shotRules.js` (scatter/scheduled per-shot picks and timing), `equalPowerRamp.js`, `groupDrift.js`, `pan.js`, `eqBands.js`, `constants.js`, `volumeScale.js` (the bipolar volume slider) (`test/shotRules.test.js` guards their imports).
- `src/renderer/` — `main.js` bootstrap; `core/TabHost.js`, `core/PluginLoader.js`; `toolbar/` the top bar (React; state pushed in by the Mixer, sleep timer, main.js); `components/` icons shared across screens; `settings/` the Settings page (React; plugin toggles, Restricted mode, store Browse); `tabs/mixer/` the Mixer; `audio/` engine, sources, clip meters; `ui/` Mixer-only widgets.
- Official plugins (Remix, Export, Composite, Browse Sounds, Community) live in their own repos, `Venari-Hunt/noctivago-<id>`, and install from the store; `dev-plugins/` holds dev-only test fixtures.
- `scripts/dev-plugin.mjs` — copies a local plugin build into the dev app (live swap); see docs/plugins.md "Dev loop".
- `scripts/cdp-shot.mjs` — screenshots the running dev app (`npm run dev -- --remoteDebuggingPort 9222`): `node scripts/cdp-shot.mjs <out.png> [--width 1280] [--height 800] [--eval "<js>"]`; flaky while the window is hidden in the tray.
- `scripts/mock-diff.mjs` — compares the approved desktop mock with the running dev app (controls, labels, icons by drawing, heights) per region: `node scripts/mock-diff.mjs [--screen mixer] [--width 1280]`; run it before calling a redesign step done. Differences caused only by data (preset name, playing state, a plugin not installed) are expected.
- `scripts/ui-audit.mjs` — shoots every tab and Settings page of the running dev app at 480, 800 and 1280 and flags sideways overflow, unnamed controls, targets under 24 px and text under 4.5:1: `node scripts/ui-audit.mjs <out-dir> [--widths 480,800,1280] [--only mixer,export]`; writes a contact.html sheet.
- `e2e/` — end-to-end tests that launch the built app on a throwaway profile over the DevTools port (playwright-core, dev only): `npm run test:e2e` (builds first). Covers shortcuts, Settings pages, search, Delete + Undo, the preset pill (autosave on and off), real exports (WAV, FLAC, MP3, Opus; a native dialog is answered by NOCTIVAGO_E2E_FOLDER, see src/main/devMode.js), presets and settings through the real main process, and the Remix, Export, Composite and Browse Sounds tabs (needs the plugin repos built next to this one in ../noctivago-plugin-repos). Not part of `npm test`.
- `scripts/side-by-side.mjs` — Desktop 2.0 step 20: builds v0.1.274 (commit be0c70d) in a sibling worktree `../noctivago-audit-old` and opens it (muted) next to the new build, each on its own copy of the real profile (`%APPDATA%
octivago-audit-old` / `-new`; timers, updates and the Community key left out). `--fresh` recopies the profiles. Unpackaged runs pick a profile with `NOCTIVAGO_PROFILE`.

## Docs (read only the one a task touches)

- `docs/playback.md` — stream/buffer playback, crossfades, scatter/scheduled, waveforms, clip meters, why ffmpeg.
- `docs/plugins.md` — plugin architecture, React build, store, Remix.
- `docs/presets.md` — per-preset sound overrides.
- `docs/freesound-and-browse.md` — Freesound + Browse Sounds.
- `docs/community-presets.md` — Cloudflare backend, `.ncvpreset`.
- `docs/watch-folders.md` — watched-folder import.
- `docs/mobile.md` — phone player plan (React Native + react-native-audio-api, desktop bakes clips).
- `docs/releasing.md` — releases, auto-update, Stable and Nightly channels, data that survives a downgrade, itch.io.
- `CHANGELOG.md` — dated release history (what exists). Old version numbers in docs are provenance, not things to re-verify.

**Doc site:** `Venari-Hunt/noctivago-docs` (plain HTML, push to `main`). Update it whenever possible: any user-facing change updates its page, and each release updates What's new (`node tools/build-changelog.mjs <this repo>/CHANGELOG.md`) before the tag. Batch only if it's truly expensive, and never past the next major release.
