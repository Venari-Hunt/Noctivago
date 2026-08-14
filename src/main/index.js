import { app, BrowserWindow, shell, protocol, net } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerIpcHandlers } from './ipc.js'
import { getPlaybackPathForId } from './library.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sound',
    privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
  }
])

function registerSoundProtocol() {
  protocol.handle('sound', async (request) => {
    const id = new URL(request.url).hostname
    const filePath = getPlaybackPathForId(id)
    if (!filePath) return new Response('Not found', { status: 404 })

    const response = await net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers
    })
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, headers })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    title: 'Noctívago',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerSoundProtocol()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
