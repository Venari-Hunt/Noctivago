import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// yt-dlp.exe isn't an npm dependency (ffmpeg-static's role, but every
// maintained npm wrapper package either bundles a stale binary or - like
// youtube-dl-exec - requires Python just to run `npm install`, a dealbreaker
// for a non-developer owner's dev machine and a real fragility risk for
// anyone building this app fresh). Instead scripts/download-ytdlp.mjs
// (repo-root "postinstall") fetches the real standalone Windows yt-dlp.exe
// (no separate Python install needed) straight from its own GitHub releases
// into resources/bin/yt-dlp.exe - same dev/packaged path split as
// ffmpegPath.js, packaged via electron-builder.yml's own extraResources
// entry (not asarUnpack, since it's never inside node_modules/asar to begin
// with).
// electron-vite bundles every src/main/** file into one flat out/main/
// index.js - __dirname at runtime is always out/main/ regardless of this
// file's own source depth, so the dev-mode relative path matches
// registry.js's own bundledPluginsDir() convention (out/main -> out -> repo
// root), not this file's actual src/main/ytdlp/ location. Confirmed by
// inspecting the real build output before writing this, not assumed.
export function resolveYtDlpPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'yt-dlp.exe')
    : path.join(__dirname, '../../resources/bin/yt-dlp.exe')
}

export function isYtDlpAvailable() {
  try {
    return fs.existsSync(resolveYtDlpPath())
  } catch {
    return false
  }
}
