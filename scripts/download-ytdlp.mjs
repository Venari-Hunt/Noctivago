// Downloads the standalone yt-dlp.exe (self-contained, no separate Python
// install needed - unlike some npm wrapper packages, e.g. youtube-dl-exec,
// which requires Python just to run `npm install`, ruled out for exactly
// that reason) into resources/bin/yt-dlp.exe, mirroring how ffmpeg-static's
// own postinstall fetches its binary. Run automatically via package.json's
// "postinstall" script; safe to re-run (skips if the file already exists,
// unless --force is passed).
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEST_DIR = path.join(__dirname, '..', 'resources', 'bin')
const DEST_PATH = path.join(DEST_DIR, 'yt-dlp.exe')
// GitHub's own "always latest" redirect - yt-dlp's README documents this as
// the stable URL for always getting the current release's asset, so this
// doesn't need updating as new yt-dlp versions ship.
const DOWNLOAD_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FORCE = process.argv.includes('--force')

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'))
          res.resume()
          resolve(download(res.headers.location, destPath, redirectsLeft - 1))
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`download failed: HTTP ${res.statusCode}`))
          return
        }
        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('download-ytdlp: skipping (non-Windows platform, this app only ships a Windows build)')
    return
  }
  if (fs.existsSync(DEST_PATH) && !FORCE) {
    console.log(`download-ytdlp: ${DEST_PATH} already present, skipping (pass --force to re-download)`)
    return
  }
  fs.mkdirSync(DEST_DIR, { recursive: true })
  const tmpPath = `${DEST_PATH}.download`
  console.log(`download-ytdlp: fetching ${DOWNLOAD_URL} …`)
  try {
    await download(DOWNLOAD_URL, tmpPath)
    fs.renameSync(tmpPath, DEST_PATH)
    console.log(`download-ytdlp: saved to ${DEST_PATH}`)
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup
    }
    console.error(`download-ytdlp: failed - ${err.message}`)
    console.error('download-ytdlp: "Add from video URL" will not work until this succeeds - re-run "node scripts/download-ytdlp.mjs" once network access is available.')
    // Non-fatal: don't fail the whole `npm install` over an optional feature's
    // binary - matches how a missing ffmpeg-static binary is handled today
    // (checked lazily, documented recovery step), not a hard install failure.
  }
}

main()
