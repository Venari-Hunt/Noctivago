<!-- Part of Noctívago's docs. See ../CLAUDE.md for the map of what lives where. -->

## Releasing and auto-update

`npm run release:win` (`electron-vite build && electron-builder --win --publish always`) builds the Windows installer and publishes it as a GitHub Release, via `electron-builder.yml`'s `publish` config. A GitHub Actions workflow can run this automatically on any pushed tag matching `v*`, using GitHub Actions' own auto-provided `GITHUB_TOKEN` to create the release and upload the installer.

**In-app update checking** (`src/main/autoUpdate.js`, `electron-updater`) checks GitHub Releases on every startup of a *packaged* build (`app.isPackaged` gate — never runs under `npm run dev`), and only ever prompts before acting: a "Download?" dialog on `update-available`, then a separate "Restart now?" dialog on `update-downloaded`. `autoUpdater.autoDownload`/`autoInstallOnAppQuit` are both `false` for exactly this reason — nothing happens silently.

If this repository is public, `electron-updater`'s GitHub provider can read releases with no authentication at all — no token needed. (If forking this project to a private repository, `electron-updater`'s GitHub provider needs a token to read releases; see its own documentation for the `GH_TOKEN` environment variable it reads at runtime — avoid baking a broad-access token into a shipped binary, use a narrowly-scoped, read-only token instead.)

**itch.io** gets the exact same installer the GitHub release just published, pushed via Butler in the same workflow run (`.github/workflows/release.yml`, skips itself gracefully until `ITCH_BUTLER_API_KEY` is set as a repo secret). This used to be a second, separate build made deliberately without a private-repo update token so a working repo-clone credential wouldn't end up on a public download page — now that the repo itself is public and that token is gone entirely (see the note above), there's nothing left to keep the two builds apart, so it's one build, published twice.


## Stable and Nightly channels

Settings, Updates, **Update channel** picks Stable (default) or Nightly (`settings.updateChannel`).

- **Nightly builds:** `.github/workflows/nightly.yml` tests, versions the build (`NIGHTLY_BASE` or the next patch, plus `-nightly.<date>.<run>`), publishes it as a GitHub **pre-release**, and keeps the newest 10 nightlies. While 2.0 is built, nightlies come from the `ui-redesign` branch (versioned `2.0.0-nightly...`, on every push there); on `master` it runs only by hand. Promoting a nightly: tag that commit as a stable release (owner says which).
- **Stable builds:** the tag release in `release.yml`, unchanged. GitHub's `/releases/latest`, which Stable checks, never returns a pre-release.
- **In the app** (`autoUpdate.js` `applyUpdateChannel()`): Nightly sets `allowPrerelease`. Stable on a nightly version sets `allowDowngrade`, so the newest stable (an older version) installs over it. Switching channel checks right away and offers it in the Update modal.

## Data that survives a downgrade

Going back from Nightly to Stable means an older app opens data a newer one wrote. How other apps handle it, and what Noctívago copies:

- Firefox: `compatibility.ini` stamps the last version that opened a profile and refuses an older one (downgrade protection). Here: `userData/data-version.json` stamps `{ schema, version }`.
- Chrome: snapshots user data after each major update and on rollback restores the newest snapshot not newer than the version being run (`chrome/browser/downgrade/snapshot_manager.cc`). Here: `userData/snapshots/<previous version>/` holds a copy of `library.json`, `presets.json`, `settings.json`, `community.json` on every upgrade. Kept: the newest 3, plus the newest of each schema, plus every set-aside copy.
- Joplin: an older app meeting a newer "profile version" stops with a fatal error. That is what this avoids.

**The rule for every change to saved data** (library, presets, settings, community stores):

1. **Additive only.** Add new fields; keep writing the old ones while a stable release still reads them; never rename, remove or change the meaning or type of a field in the same release that starts using its replacement (expand, then contract a release later). Code that rewrites an entry spreads the stored object, so fields it does not know survive.
2. **Readers tolerate.** Missing field = default; unknown field = ignore and keep.
3. **Only when 1 is impossible**, raise `DATA_SCHEMA` in `src/shared/dataSchema.js`, in the same commit as the change. Then a downgrade restores the last snapshot from before the change (newer data is moved to a `-set-aside` snapshot and a dialog says so, with a Show folder button). Work done in the newer version is not shown in the older one, but nothing is deleted.

Audio in `sounds/` is not snapshotted (files are only added or removed, never rewritten), and `clips/` is a cache. `updateChannel` is carried over a restore, so a downgrade never flips the channel back to Nightly. Tests: `test/dataGuard.test.js`.
