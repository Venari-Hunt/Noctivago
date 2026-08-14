# Noctívago

Windows desktop ambient sound mixer, inspired by the Linux app [Blanket](https://github.com/rafaelmardojai/blanket) (not a port — Blanket is GTK/Linux-only). Electron + vanilla JS/DOM (no UI framework). Original MVP spec: `C:\Users\jluca\.claude\plans\ok-i-m-fine-with-hidden-lemur.md`.

The user (owner of this project) is not a developer — explain setup steps explicitly, don't assume familiarity with the toolchain.

## Running it

```
npm run dev
```

Two environment quirks that show up in fresh shells on this machine (both needed before `npm`/`node`/Electron will work):
- `node`/`npm` aren't reliably on `PATH` in every shell — `$env:Path += ";C:\Program Files\nodejs"` if `node -v` fails.
- If launching Electron produces `Cannot read properties of undefined (reading 'whenReady')`, an inherited `ELECTRON_RUN_AS_NODE=1` env var is forcing Electron to run as plain Node. Clear it: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

## Architecture

- `src/main/` — Electron main process. `index.js` (window + custom `sound://` protocol registration), `ipc.js` (IPC handlers), `library.js` (registered sound files, persisted via `electron-store`), `presets.js` (saved mixes).
- `src/preload/index.js` — contextBridge API exposed to the renderer as `window.noctivago`.
- `src/renderer/` — plain JS/DOM UI. `audio/AudioEngine.js` + `audio/SoundSource.js` (Web Audio graph), `ui/*.js` (SoundList, SoundRow, PresetsModal, LoopEditor), `main.js` (wires it all together).

**Playback streams, it does not fully decode.** Each sound plays through an `<audio>` element (`src="sound://<id>"`) piped into a `MediaElementAudioSourceNode → per-sound GainNode → master GainNode`. The `sound://` protocol is a custom Electron scheme (`protocol.handle` in `main/index.js`) that resolves a library entry's real file path and streams it via `net.fetch(file://...)`, with `Access-Control-Allow-Origin: *` added so the Web Audio graph isn't CORS-tainted.

This replaced an earlier `decodeAudioData`/`AudioBufferSourceNode` approach that loaded whole files into memory — it worked for short clips but threw `EncodingError` and silently hung on real ambience files (278MB/526MB multi-hour recordings), which is exactly the kind of file this app needs to support. **Known tradeoff:** looping is now a `requestAnimationFrame` boundary-check + seek-back on the loop point, not sample-accurate like native `AudioBufferSourceNode.loopStart/loopEnd` — there may be an audible click/gap at the loop seam that the old approach didn't have. Worth comparing against how Blanket (GStreamer-based, also streaming) achieves gapless looping if the seam is a problem.

The Loop Editor (`LoopEditor.js`, `waveform.js`) draws a time-ruler, not an amplitude waveform — real peaks would require the same full-decode that doesn't scale to long files. It only needs duration (from `<audio>` metadata, which loads fast even for huge files) plus drag handles.

## Status

As of 2026-08-14: full rewrite above is code-complete but **not yet verified end-to-end** (play/pause, volume drag, trim + preview, save/load preset — especially with a genuinely long file). Verify before trusting it works.
