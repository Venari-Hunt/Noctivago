// Generates resources/thumbar-play.png and resources/thumbar-pause.png,
// the icons shown on Noctívago's Windows taskbar thumbnail preview toolbar
// (BrowserWindow.setThumbarButtons, wired in src/main/index.js).
//
// Same rendering technique as the app icon build (see the CLAUDE.md "App
// icon" section): a throwaway, transparent Electron BrowserWindow loads a
// hand-authored inline SVG (the same play/pause glyph paths already used
// for the in-app icon buttons - PLAY_ICON_SVG/PAUSE_ICON_SVG in
// tabs/mixer/index.js), capturePage() screenshots it to PNG, then ffmpeg
// downsamples to the final size for a crisp result instead of rendering
// directly at the small target size. Run via Electron itself, not plain
// node, since capturePage() needs a real renderer - one glyph per
// invocation (a second BrowserWindow in the same process intermittently
// hung on capturePage(), not worth chasing down for a one-off asset script):
//   node_modules\.bin\electron.cmd resources/icon-src/build-thumbar-icons.mjs play
//   node_modules\.bin\electron.cmd resources/icon-src/build-thumbar-icons.mjs pause
//
// disableHardwareAcceleration() is required before app.whenReady() - without
// it capturePage() throws UnknownVizError, the same gotcha hit building the
// app icon itself.

import { app, BrowserWindow, screen } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '../..')
const FFMPEG = path.join(REPO_ROOT, 'node_modules/ffmpeg-static/ffmpeg.exe')

const RENDER_SIZE = 128
const FINAL_SIZE = 32

// Same glyph paths as PLAY_ICON_SVG/PAUSE_ICON_SVG in
// src/renderer/tabs/mixer/index.js, just rendered white for a taskbar
// button instead of `currentColor` for an in-app icon button.
const GLYPHS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
}

const name = process.argv[process.argv.length - 1]
const glyph = GLYPHS[name]
if (!glyph) {
  console.error(`Usage: build-thumbar-icons.mjs <${Object.keys(GLYPHS).join('|')}>`)
  process.exit(1)
}

function htmlFor(g) {
  return `data:text/html,<html><body style="margin:0;background:transparent">` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_SIZE}" height="${RENDER_SIZE}" viewBox="0 0 24 24" fill="white">${g}</svg>` +
    `</body></html>`
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

// Opens on the highest-numbered connected display (same convention as
// devWindowPosition() in src/main/index.js) rather than the primary one,
// since this pops up briefly on screen while it renders.
function targetPosition() {
  const displays = screen.getAllDisplays()
  const target = displays.reduce((best, d) => (d.bounds.x > best.bounds.x ? d : best))
  return {
    x: Math.round(target.bounds.x + (target.bounds.width - RENDER_SIZE) / 2),
    y: Math.round(target.bounds.y + (target.bounds.height - RENDER_SIZE) / 2)
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    ...targetPosition(),
    show: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false }
  })
  await win.loadURL(htmlFor(glyph))
  await new Promise((resolve) => setTimeout(resolve, 200))
  const image = await win.webContents.capturePage()
  const rawPath = path.join(__dirname, `_tmp-thumbar-${name}.png`)
  fs.writeFileSync(rawPath, image.toPNG())
  win.destroy()

  const finalPath = path.join(REPO_ROOT, `resources/thumbar-${name}.png`)
  execFileSync(FFMPEG, [
    '-y', '-i', rawPath,
    '-vf', `scale=${FINAL_SIZE}:${FINAL_SIZE}:flags=lanczos`,
    '-frames:v', '1',
    finalPath
  ], { stdio: 'ignore' })
  fs.unlinkSync(rawPath)
  console.log('wrote', finalPath)
  app.quit()
})
