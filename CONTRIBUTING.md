# Contributing to Noctívago

Thanks for considering a contribution! Noctívago is an Electron + vanilla
JS/DOM ambient sound mixer for Windows, inspired by
[Blanket](https://github.com/rafaelmardojai/blanket) — see `CLAUDE.md` for
the full architecture writeup.

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

- **No UI framework.** The renderer is plain JS/DOM — see `src/renderer/`.
  New UI should follow the existing module patterns (`ui/*.js`,
  `tabs/*/index.js`) rather than introducing a framework or a new
  rendering abstraction.
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
  copy rather than reaching across the boundary. See the "Plugins" section
  of `CLAUDE.md` for the full plugin API and security model.
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
