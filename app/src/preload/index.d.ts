import type { ElectronAPI } from '@electron-toolkit/preload'
import type { MusicSorterAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: MusicSorterAPI
  }
}
