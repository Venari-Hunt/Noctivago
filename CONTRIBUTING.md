# Contributing to Noctívago

Thanks for considering a contribution! Noctívago is an Electron + React
ambient sound mixer for Windows (older screens are still plain JS/DOM) — see `CLAUDE.md` for the full
architecture writeup.

## Before you open a pull request

**A CLA is required before any PR can be merged.** Read [CLA.md](CLA.md).
When you open your first pull request, a bot will comment asking you to
sign it by replying with the exact phrase it gives you — no external
account or sign-up needed, your signature is just recorded in this repo.
You only need to do this once; it's remembered for future PRs.

## Building and running locally

```
npm install
npm run dev
```

`npm run dev` first builds any plugin written in JSX (`plugins/<id>/src/`)
into its `main.js`, plus any React "islands" (`plugins/<id>/src/islands/*.jsx`,
like Remix's filter sliders) into `plugins/<id>/islands/`. While editing one, run `npm run dev:plugins` in a
second terminal to rebuild on save, then reload the app
window. See `docs/plugins.md` and the `plugins/hello-react/` example.

Two environment quirks show up in fresh shells on some Windows setups
(both needed before `npm`/`node`/Electron will work):

- `node`/`npm` aren't always on `PATH` — if `node -v` fails, add Node's
  install directory to `PATH` for the session (on Windows,
  `$env:Path += ";C:\Program Files\nodejs"` in PowerShell, adjusted to
  wherever Node is actually installed).
- If launching Electron produces
  `Cannot read properties of undefined (reading 'whenReady')`, an
  inherited `ELECTRON_RUN_AS_NODE=1` environment variable is forcing
  Electron to run as plain Node. Clear it before running `npm run dev`.

`ffmpeg-static`'s postinstall (which downloads the actual ffmpeg binary)
sometimes gets skipped by npm's script-allowlist prompt — if
ffmpeg-dependent features (waveform, loop clips, exports) fail, check that
`node_modules/ffmpeg-static/ffmpeg.exe` (or the equivalent for your
platform) exists; if not, run `node node_modules/ffmpeg-static/install.js`.

## Code conventions

- **Every screen is split into `domain/` and `components/`.** This applies
  to the whole project: the Mixer, Settings, dialogs and every plugin.
  - `domain/`: the screen's rules and behavior (what the feature does),
    plus its utilities. No DOM, so it can be tested and debugged alone.
  - `components/`: the interface, as small React components that each do
    one thing, rather than one giant file. Canvas-heavy pieces (waveform,
    meters, EQ graph) stay imperative drawing code inside a component.
  - Anything used by only one screen stays in that screen's folder.
    Logic shared by several screens goes in `src/shared/` (main + renderer)
    or `src/renderer/domain/` (renderer only).
  - The main process has no screens; its modules (`library.js`,
    `presets.js`, `ffmpeg/`) are already split by concern. Keep them that
    way rather than growing one file.

  Older code (the Mixer's 2,400-line `tabs/mixer/index.js`, Remix's
  6,000-line `index.js`) predates this and moves over as each screen is
  rewritten, not in one big pass. New screens start in this layout.
- **No comments explaining *what* code does.** Well-named identifiers
  should make that clear on their own. A comment is only worth adding
  when it explains a non-obvious *why* — a hidden constraint, a workaround
  for a specific bug, a subtle invariant.
- **Don't add speculative abstraction.** Prefer three similar lines over a
  premature helper; don't design for hypothetical future requirements.
- **Plugins are self-contained.** A plugin (`plugins/<id>/`) cannot import
  files outside its own directory — the `plugin://` protocol enforces this
  with a path-traversal guard. If a plugin needs something core already
  has (e.g. `AudioEngine.js`, waveform drawing code), it keeps its own
  copy rather than reaching across the boundary. See `docs/plugins.md`
  for the full plugin API and security model.
  Plugins follow the same `domain/` + `components/` layout. It's required
  for plugins in this repo and recommended for community store plugins.
- **ffmpeg is the answer for anything that needs to process a whole audio
  file** (loop clips, waveforms, exports) rather than decoding it fully
  into memory client-side — see `CLAUDE.md`'s "Why ffmpeg, not more JS"
  section for why that boundary exists.

## Testing your change

There isn't an automated test suite yet for most of the app (a `test/`
folder covering the pure-logic modules is a planned addition — see open
issues). For anything touching playback, filters, export, or the plugin
system, please describe how you manually verified the change in your PR
description — what you did in the running app and what you observed.

## Pull request process

1. Open an issue first for anything beyond a small, obvious fix, so the
   approach can be discussed before you put in the work.
2. Keep PRs scoped to one change — easier to review, easier to revert if
   something's wrong.
3. Update `CHANGELOG.md` with a short, user-facing entry for your change,
   following the existing format (newest entry on top).
4. Describe what you changed and why in the PR description, and how you
   tested it.

## Reporting bugs / requesting features

Open a GitHub issue. For anything that could be a security issue, please
see `SECURITY.md` instead of filing a public issue.
