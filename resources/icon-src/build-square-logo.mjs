// Generates a plain square PNG logo (transparent outside the circle) at any
// size, straight from render.html's SVG - same source as icon-master.png,
// just rendered directly at the requested size instead of a fixed 512 then
// scaled. Same technique as the other icon-src scripts: a throwaway,
// transparent Electron BrowserWindow + capturePage(), rendered at 2x the
// target and lanczos-downsampled by ffmpeg for a crisp anti-aliased edge.
//
// Run via Electron itself (capturePage() needs a real renderer), with
// ELECTRON_RUN_AS_NODE unset (see CLAUDE.md's env gotchas) and a size arg:
//   node_modules\.bin\electron.cmd resources/icon-src/build-square-logo.mjs 1080

import { app, BrowserWindow, screen } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '../..')
const FFMPEG = path.join(REPO_ROOT, 'node_modules/ffmpeg-static/ffmpeg.exe')

const SIZE = Number(process.argv[process.argv.length - 1]) || 1080
// Rendered directly at the target size (capped to fit on screen - the
// window briefly shows on the secondary display while it renders) since
// this is vector source (the SVG's viewBox, not a raster upscale) - no
// supersampling needed for a crisp result. The final ffmpeg pass forces the
// exact pixel size regardless of any DPI-scaling mismatch in the capture.
const RENDER_SIZE = Math.min(SIZE, 1000)

// Same SVG as render.html (the bat-on-accent-circle design), just rendered
// at RENDER_SIZE instead of a fixed 512 - the viewBox stays 0 0 256 256, so
// this is a lossless vector scale-up, not an upscale of a raster source.
const SVG = `<svg width="${RENDER_SIZE}" height="${RENDER_SIZE}" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <circle cx="128" cy="128" r="124" fill="#7aa2f7"/>
  <g fill="#ffffff">
    <ellipse cx="128" cy="150" rx="10" ry="16"/>
    <circle cx="128" cy="120" r="13"/>
    <polygon points="118,110 122,84 128,112"/>
    <polygon points="138,110 134,84 128,112"/>
    <path id="rwing" d="M128,132 C148,114 162,100 196,92 C188,104 180,110 192,120 C177,123 173,130 184,144 C167,140 159,147 152,160 C146,147 139,140 128,142 Z"/>
    <use href="#rwing" transform="translate(256,0) scale(-1,1)"/>
  </g>
</svg>`

const htmlDataUrl = `data:text/html,${encodeURIComponent(
  `<html><body style="margin:0;background:transparent">${SVG}</body></html>`
)}`

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')

function targetPosition(renderSize) {
  const displays = screen.getAllDisplays()
  const target = displays.reduce((best, d) => (d.bounds.x > best.bounds.x ? d : best))
  return {
    x: Math.round(target.bounds.x + (target.bounds.width - Math.min(renderSize, 800)) / 2),
    y: Math.round(target.bounds.y + (target.bounds.height - Math.min(renderSize, 800)) / 2)
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    ...targetPosition(RENDER_SIZE),
    show: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false }
  })
  await win.loadURL(htmlDataUrl)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const image = await win.webContents.capturePage()
  const rawPath = path.join(__dirname, `_tmp-logo-${SIZE}.png`)
  fs.writeFileSync(rawPath, image.toPNG())
  win.destroy()

  const finalPath = path.join(REPO_ROOT, `resources/icon-src/noctivago-logo-${SIZE}.png`)
  execFileSync(FFMPEG, [
    '-y', '-i', rawPath,
    '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos`,
    '-frames:v', '1',
    finalPath
  ], { stdio: 'ignore' })
  fs.unlinkSync(rawPath)
  console.log('wrote', finalPath)
  app.quit()
})
