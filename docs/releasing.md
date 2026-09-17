<!-- Part of Noctívago's docs. See ../CLAUDE.md for the map of what lives where. -->

## Releasing and auto-update

`npm run release:win` (`electron-vite build && electron-builder --win --publish always`) builds the Windows installer and publishes it as a GitHub Release, via `electron-builder.yml`'s `publish` config. A GitHub Actions workflow can run this automatically on any pushed tag matching `v*`, using GitHub Actions' own auto-provided `GITHUB_TOKEN` to create the release and upload the installer.

**In-app update checking** (`src/main/autoUpdate.js`, `electron-updater`) checks GitHub Releases on every startup of a *packaged* build (`app.isPackaged` gate — never runs under `npm run dev`), and only ever prompts before acting: a "Download?" dialog on `update-available`, then a separate "Restart now?" dialog on `update-downloaded`. `autoUpdater.autoDownload`/`autoInstallOnAppQuit` are both `false` for exactly this reason — nothing happens silently.

If this repository is public, `electron-updater`'s GitHub provider can read releases with no authentication at all — no token needed. (If forking this project to a private repository, `electron-updater`'s GitHub provider needs a token to read releases; see its own documentation for the `GH_TOKEN` environment variable it reads at runtime — avoid baking a broad-access token into a shipped binary, use a narrowly-scoped, read-only token instead.)

**itch.io** gets the exact same installer the GitHub release just published, pushed via Butler in the same workflow run (`.github/workflows/release.yml`, skips itself gracefully until `ITCH_BUTLER_API_KEY` is set as a repo secret). This used to be a second, separate build made deliberately without a private-repo update token so a working repo-clone credential wouldn't end up on a public download page — now that the repo itself is public and that token is gone entirely (see the note above), there's nothing left to keep the two builds apart, so it's one build, published twice.

