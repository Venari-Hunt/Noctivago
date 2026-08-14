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
  - `index.js` — window creation, custom `sound://` protocol (serves either the original file or a rendered loop clip, see below).
  - `ipc.js` — IPC handlers.
  - `library.js` — registered sound files, persisted via `electron-store`.
  - `presets.js` — saved mixes.
  - `ffmpeg/` — ffmpeg integration (see below). `runFfmpeg.js` is the reusable spawn wrapper; `ffmpegPath.js` resolves the bundled binary; `loopClip.js` and `waveformPeaks.js` are its two current consumers.
- `src/preload/index.js` — contextBridge API exposed to the renderer as `window.noctivago`.
- `src/shared/constants.js` — plain constants imported by both main and renderer (e.g. `MAX_BUFFER_CLIP_SECONDS`).
- `src/renderer/` — plain JS/DOM UI. `audio/AudioEngine.js`, `audio/SoundSource.js` (streaming playback), `audio/BufferSoundSource.js` (buffer/gapless playback), `ui/*.js` (SoundList, SoundRow, PresetsModal, LoopEditor), `main.js` (wires it all together).

### Playback: two modes, chosen automatically per sound

**Stream mode** (`LocalFileSoundSource`, the default): each sound plays through an `<audio>` element (`src="sound://<id>"`) piped into `MediaElementAudioSourceNode → per-sound GainNode → master GainNode`. The `sound://` protocol hand-rolls HTTP Range support via `fs.createReadStream` (Electron's `net.fetch` on `file://` URLs was found to silently ignore Range headers in this Electron version — don't assume it works, verify). Looping is a `requestAnimationFrame` boundary-check + seek-back — not sample-accurate, can have an audible click/gap at the seam. This is what makes arbitrarily long files (hours) playable at all without loading them into memory.

**Buffer mode** (`BufferSoundSource`): whenever the user trims and saves loop points in the Loop Editor, ffmpeg renders *just that loop region* out to a small WAV (`src/main/ffmpeg/loopClip.js`, `getUserData()/clips/<id>.wav`) — but only if the region is ≤ `MAX_BUFFER_CLIP_SECONDS` (600s/10min, in `src/shared/constants.js`). Since the clip is now short regardless of how long the source file was, it's fully decoded client-side (`decodeAudioData`) into a native `AudioBufferSourceNode` with true `loop=true`/`loopStart`/`loopEnd` — sample-accurate, click-free. `main.js`'s `getOrCreateSource` checks `entry.loopClipReady` + that the clip's recorded loop points still match the entry's live ones (staleness check) before trying buffer mode, and falls back to stream mode on *any* failure (missing ffmpeg, corrupt clip, decode error) — buffer mode is strictly additive, never required for the app to work.

`BufferSoundSource.pause()` tracks elapsed offset manually (`AudioBufferSourceNode` is one-shot — can't be pause/resumed like `<audio>` can) so resuming continues from the same position rather than restarting, matching stream mode's behavior.

### Waveform

`src/main/ffmpeg/waveformPeaks.js` streams the *whole* original file through ffmpeg as downsampled mono float32 PCM and reduces it into `[min,max]` peaks per pixel column with O(1) memory (never buffers the decoded audio) — works for files of any length/format. This replaced an earlier renderer-side `decodeAudioData`-based approach that was capped at 30 minutes and fell back to a bare time-ruler beyond that.

### Why ffmpeg, not more JS

Both the loop-seam click and the waveform-for-long-files problems trace back to the same root cause: `decodeAudioData` on a whole multi-hour file either throws `EncodingError` or uses gigabytes of RAM (this is *why* stream mode exists at all — see git history around the original long-file rewrite). ffmpeg (bundled via `ffmpeg-static`, spawned via `child_process`, never a shell) processes files without holding them fully in memory, sidestepping that limit entirely. `runFfmpeg.js` is deliberately generic/domain-agnostic so future ffmpeg-based features (filters, re-encoding — explicitly wanted as a longer-term direction, not yet built) reuse it rather than each rolling their own spawn logic.

**Packaging note (untested as of this writing):** `electron-builder.yml` has `asarUnpack: [node_modules/ffmpeg-static/**]` — required because binaries can't execute from inside an asar archive. Works in `npm run dev` regardless; only provable by actually running `npm run build:win` and testing the installed app.

## Status

As of 2026-08-14: mix/preset model (per-sound "include in mix" toggle, global play/pause, global volume), Loop Editor (drag handles + numeric inputs + draggable/snapping playhead needle + real waveform + play/pause preview), and the ffmpeg-based buffer-mode/waveform system above are all implemented and verified in dev via CDP-driven testing (play/pause, pause-resume position preservation, cap fallback behavior, clip cleanup on delete, a real ~4-hour file). **Not yet done:** a packaged-build (`npm run build:win`) smoke test — the asar-unpack path literally cannot be verified any other way, so treat packaging as unverified until someone actually runs the built installer.
