import { app, shell, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'audio/mp4'
}

// Custom protocol so the renderer can load local audio files without us
// having to relax web security. Registered as privileged so wavesurfer.js
// and HTMLAudioElement can fetch + stream from it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-audio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()

  // Resolve local-audio:// URLs by reading the file off disk and returning
  // a CORS-friendly Response. URL format we expect:
  //   local-audio:///<absolute-path-with-forward-slashes>
  // e.g. local-audio:///Z:/Downloads/foo.mp3
  //
  // We send back the entire file (not Range-streamed) which is fine for
  // typical music files; createMediaElementSource needs explicit CORS to
  // avoid tainting the audio element for the Web Audio analyser.
  protocol.handle('local-audio', async (request) => {
    try {
      const url = new URL(request.url)
      const decoded = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const data = await fsp.readFile(decoded)
      const dot = decoded.lastIndexOf('.')
      const ext = dot === -1 ? '' : decoded.slice(dot + 1).toLowerCase()
      const mime = AUDIO_MIME_TYPES[ext] || 'application/octet-stream'
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': data.byteLength.toString(),
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (err) {
      console.error('local-audio handler failed:', err)
      return new Response(`error: ${(err as Error).message}`, { status: 500 })
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
