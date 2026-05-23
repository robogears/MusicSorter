import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AudioFile,
  AudioMetadata,
  Config,
  MoveResult,
  TagLookupResult,
  UpdateActionResult,
  UpdateDownloadProgress,
  UpdateStatus
} from '../shared/types'

/**
 * Typed renderer-side API. The matching handlers live in src/main/ipc.ts.
 * Don't put logic here — just thin invoke() wrappers.
 */
const api = {
  scanDownloads: (dir: string, recurse: boolean, exts: string[]): Promise<AudioFile[]> =>
    ipcRenderer.invoke('fs:scanDownloads', dir, recurse, exts),
  scanLibrary: (root: string, exts: string[]): Promise<string[]> =>
    ipcRenderer.invoke('fs:scanLibrary', root, exts),
  listGenreFolders: (root: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:listGenreFolders', root),
  ensureDir: (p: string): Promise<void> => ipcRenderer.invoke('fs:ensureDir', p),
  moveFile: (src: string, dest: string): Promise<MoveResult> =>
    ipcRenderer.invoke('fs:moveFile', src, dest),
  deleteFile: (p: string): Promise<void> => ipcRenderer.invoke('fs:deleteFile', p),
  pathExists: (p: string): Promise<boolean> => ipcRenderer.invoke('fs:pathExists', p),
  readFile: (p: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:readFile', p),
  pickFolder: (title: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:pickFolder', title),

  readMetadata: (path: string): Promise<AudioMetadata> =>
    ipcRenderer.invoke('meta:read', path),
  getTags: (artist: string, title: string): Promise<TagLookupResult> =>
    ipcRenderer.invoke('lastfm:tags', artist, title),
  computePeaks: (path: string, nBars: number): Promise<number[] | null> =>
    ipcRenderer.invoke('peaks:compute', path, nBars),

  loadConfig: (): Promise<Config> => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg: Config): Promise<void> => ipcRenderer.invoke('config:save', cfg),

  // Updater
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
  canSelfInstall: (): Promise<boolean> => ipcRenderer.invoke('update:can-self-install'),
  downloadUpdate: (url: string): Promise<UpdateActionResult> =>
    ipcRenderer.invoke('update:download', url),
  applyUpdate: (): Promise<UpdateActionResult> => ipcRenderer.invoke('update:apply'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  onUpdateAvailable: (
    cb: (payload: Extract<UpdateStatus, { status: 'available' }>) => void
  ): (() => void) => {
    const handler = (
      _e: unknown,
      payload: Extract<UpdateStatus, { status: 'available' }>
    ): void => cb(payload)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.off('update:available', handler)
  },
  onUpdateDownloadProgress: (
    cb: (payload: UpdateDownloadProgress) => void
  ): (() => void) => {
    const handler = (_e: unknown, payload: UpdateDownloadProgress): void => cb(payload)
    ipcRenderer.on('update:download-progress', handler)
    return () => ipcRenderer.off('update:download-progress', handler)
  }
}

export type MusicSorterAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
