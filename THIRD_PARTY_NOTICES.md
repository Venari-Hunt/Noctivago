# Third-Party Notices

Noctívago is licensed under Apache License 2.0 (see `LICENSE`). The
distributed application (installer/build) also includes the following
third-party components under their own separate licenses.

## FFmpeg (bundled binary, GPLv3)

Noctívago bundles a prebuilt FFmpeg binary, fetched via the `ffmpeg-static`
npm package at install/build time, and always invokes it as a **separate
child process** (`child_process.spawn`, never linked into the app's own
code) — see `src/main/ffmpeg/runFfmpeg.js`.

- **Version**: FFmpeg 6.1.1, "essentials" build from
  [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) (`www.gyan.dev`).
- **License**: GNU General Public License v3 (GPLv3). This build includes
  GPL-only components (libx264, libx265, and others), which is why the
  whole binary is GPLv3 rather than the more permissive LGPL that a
  build without those components would carry.
- **Source code**: the exact FFmpeg source this binary was built from is
  publicly available at
  [github.com/FFmpeg/FFmpeg, commit e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93).
- **Full license text and build configuration**: shipped alongside the
  binary itself in every build, at
  `node_modules/ffmpeg-static/ffmpeg.exe.LICENSE` and
  `ffmpeg.exe.README` (unpacked from the app's asar archive at build
  time via `electron-builder.yml`'s `asarUnpack`, so these files are
  physically present next to `ffmpeg.exe` in every installed copy of
  the app).

Because FFmpeg is only ever invoked as an independent subprocess (never
compiled or linked into Noctívago's own source), Noctívago's own code is
not required to be GPL-licensed as a result of bundling this binary — the
FSF's own [GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html) treats
programs communicating via `exec`/pipes/argv as separate works, not a
combined derivative. The distributed *installer as a whole*, however, is
an aggregate of Apache-2.0 app code and a separately-licensed GPLv3
binary — the GPLv3 terms above apply to the FFmpeg binary specifically.

## yt-dlp (fetched binary, Unlicense / public domain)

Noctívago fetches a standalone `yt-dlp.exe` at install time
(`scripts/download-ytdlp.mjs`) to support importing audio from a URL.
[yt-dlp](https://github.com/yt-dlp/yt-dlp) is released into the public
domain (Unlicense) — no redistribution obligations, credited here as a
courtesy.
