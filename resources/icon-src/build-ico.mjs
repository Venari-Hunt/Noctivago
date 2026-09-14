// Regenerates resources/icon.ico and resources/tray-icon.png from
// icon-master.png (a 512x512 render of render.html's SVG - re-render that
// via a throwaway Electron BrowserWindow + capturePage() if the design
// itself changes, then re-run this script).
//
// Hand-builds the .ico instead of letting electron-builder auto-convert a
// plain PNG: electron-builder's own PNG->ICO conversion PNG-compresses
// every embedded size, but Windows only honors PNG compression for the
// 256px entry - the taskbar and Windows Search both silently fall back to
// a generic icon for smaller sizes (16/24/32/48/64) if they're
// PNG-compressed instead of classic uncompressed BMP/DIB data. This script
// builds each size below 256 as real BMP/DIB (with a proper 1bpp AND mask
// derived from the alpha channel), and only PNG-compresses the 256 entry,
// which is spec-correct. Verified by loading the result back through
// .NET's System.Drawing.Icon (Windows' own icon parser), not just by
// trusting this script's own logic.
//
// Run from the repo root: node resources/icon-src/build-ico.mjs

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '../..')
const FFMPEG = path.join(REPO_ROOT, 'node_modules/ffmpeg-static/ffmpeg.exe')
const MASTER = path.join(__dirname, 'icon-master.png')
const TMP_DIR = __dirname

const DIB_SIZES = [16, 24, 32, 48, 64, 128]
const PNG_SIZE = 256

function rawBgraFlipped(size) {
  const out = path.join(TMP_DIR, `_tmp-${size}.bgra`)
  execFileSync(FFMPEG, [
    '-y', '-i', MASTER,
    '-vf', `scale=${size}:${size}:flags=lanczos,vflip`,
    '-pix_fmt', 'bgra',
    '-f', 'rawvideo',
    out
  ], { stdio: 'ignore' })
  const data = fs.readFileSync(out)
  fs.unlinkSync(out)
  return data
}

function pngAt(size) {
  const out = path.join(TMP_DIR, `_tmp-${size}.png`)
  execFileSync(FFMPEG, [
    '-y', '-i', MASTER,
    '-vf', `scale=${size}:${size}:flags=lanczos`,
    '-frames:v', '1',
    out
  ], { stdio: 'ignore' })
  const data = fs.readFileSync(out)
  fs.unlinkSync(out)
  return data
}

function buildDibEntry(size) {
  const bgra = rawBgraFlipped(size) // bottom-up row order already, BGRA per pixel
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight (XOR+AND doubled, per ICO convention)
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // biCompression = BI_RGB
  header.writeUInt32LE(bgra.length, 20) // biSizeImage

  // AND mask: 1bpp, rows padded to 4-byte boundary, same bottom-up order as color data
  const maskRowBytes = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRowBytes * size, 0)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const alpha = bgra[(row * size + col) * 4 + 3]
      if (alpha === 0) {
        const byteIndex = row * maskRowBytes + (col >> 3)
        mask[byteIndex] |= 0x80 >> (col & 7)
      }
    }
  }

  return Buffer.concat([header, bgra, mask])
}

const entries = []
for (const size of DIB_SIZES) {
  entries.push({ size, data: buildDibEntry(size) })
}
entries.push({ size: PNG_SIZE, data: pngAt(PNG_SIZE) })

const dirHeader = Buffer.alloc(6)
dirHeader.writeUInt16LE(0, 0)
dirHeader.writeUInt16LE(1, 2)
dirHeader.writeUInt16LE(entries.length, 4)

let offset = 6 + entries.length * 16
const dirEntries = []
for (const e of entries) {
  const de = Buffer.alloc(16)
  de.writeUInt8(e.size >= 256 ? 0 : e.size, 0)
  de.writeUInt8(e.size >= 256 ? 0 : e.size, 1)
  de.writeUInt8(0, 2)
  de.writeUInt8(0, 3)
  de.writeUInt16LE(1, 4) // planes
  de.writeUInt16LE(32, 6) // bitcount
  de.writeUInt32LE(e.data.length, 8)
  de.writeUInt32LE(offset, 12)
  offset += e.data.length
  dirEntries.push(de)
}

const ico = Buffer.concat([dirHeader, ...dirEntries, ...entries.map((e) => e.data)])
fs.writeFileSync(path.join(REPO_ROOT, 'resources/icon.ico'), ico)
console.log('wrote resources/icon.ico', ico.length, 'bytes')

execFileSync(FFMPEG, [
  '-y', '-i', MASTER,
  '-vf', 'scale=64:64:flags=lanczos',
  '-frames:v', '1',
  path.join(REPO_ROOT, 'resources/tray-icon.png')
], { stdio: 'ignore' })
console.log('wrote resources/tray-icon.png')
