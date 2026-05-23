/**
 * IPC handler registration. The preload script exposes typed wrappers around
 * the channels declared here; see src/preload/index.ts.
 */
import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from './fs'
import * as config from './config'
import { readMetadata } from './metadata'
import { getTags } from './lastfm'
import { computePeaksMain } from './peaks'
import {
  applyUpdate,
  canSelfInstall,
  downloadUpdate,
  getUpdateStatus,
  openExternal
} from './updater'
import type { Config, MoveResult } from '../shared/types'

export function registerIpc(): void {
  // ── Filesystem ────────────────────────────────────────────────
  ipcMain.handle('fs:scanDownloads', (_e, dir: string, recurse: boolean, exts: string[]) =>
    fs.scanDownloads(dir, recurse, exts)
  )
  ipcMain.handle('fs:scanLibrary', (_e, root: string, exts: string[]) =>
    fs.scanLibrary(root, exts)
  )
  ipcMain.handle('fs:listGenreFolders', (_e, root: string) => fs.listGenreFolders(root))
  ipcMain.handle('fs:ensureDir', (_e, p: string) => fs.ensureDir(p))
  ipcMain.handle('fs:moveFile', async (_e, src: string, dest: string): Promise<MoveResult> => {
    try {
      await fs.moveFile(src, dest)
      return { ok: true, destPath: dest }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('fs:deleteFile', (_e, p: string) => fs.deleteFile(p))
  ipcMain.handle('fs:pathExists', (_e, p: string) => fs.pathExists(p))
  ipcMain.handle('fs:readFile', (_e, p: string) => fs.readFile(p))

  ipcMain.handle('fs:pickFolder', async (_e, title: string) => {
    const focused = BrowserWindow.getFocusedWindow()
    const result = focused
      ? await dialog.showOpenDialog(focused, {
          title,
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title,
          properties: ['openDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── Metadata + Last.fm ────────────────────────────────────────
  ipcMain.handle('meta:read', (_e, path: string) => readMetadata(path))
  ipcMain.handle('lastfm:tags', (_e, artist: string, title: string) => getTags(artist, title))

  // ── Peak decoder fallback (when Chromium can't decode the file) ──
  ipcMain.handle('peaks:compute', (_e, path: string, nBars: number) =>
    computePeaksMain(path, nBars)
  )

  // ── Config ────────────────────────────────────────────────────
  ipcMain.handle('config:load', () => config.loadConfig())
  ipcMain.handle('config:save', (_e, cfg: Config) => config.saveConfig(cfg))

  // ── Updater ───────────────────────────────────────────────────
  // The manual check (from Settings) shares the same notice surface as the
  // automatic launch check — emit `update:available` so the UI updates the
  // same way regardless of how the check was triggered.
  ipcMain.handle('update:check', async () => {
    const result = await getUpdateStatus()
    if (result.status === 'available') {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:available', result)
      }
    }
    return result
  })
  ipcMain.handle('update:can-self-install', () => canSelfInstall())
  ipcMain.handle('update:download', (_e, url: string) => downloadUpdate(url))
  ipcMain.handle('update:apply', () => applyUpdate())
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    openExternal(url)
  })
  ipcMain.handle('app:version', () => app.getVersion())
}
