/**
 * App-wide state via Zustand. One store, shallow updates per row.
 */
import { create } from 'zustand'
import type { AudioFile, Config, GenreTag } from '../../shared/types'

export type RowStatus = 'loading' | 'ready'

export interface RowState {
  id: string // = file.path
  file: AudioFile
  artist: string | null
  title: string | null
  albumArt: string | null // data URL
  durationSeconds: number
  tags: GenreTag[]
  tagLookupError: string | null
  suggestedFolder: string | null
  topTag: string | null
  folder: string // user-selected (or pre-filled from suggestion)
  status: RowStatus
  isDuplicate: boolean
  skipped: boolean
  peaks: number[] | null // decoded amplitude envelope, normalized 0..1
}

interface AppState {
  config: Config | null
  rows: RowState[]
  genreFolders: string[]
  libraryIndex: Set<string>
  scanning: boolean
  status: string

  // Playback
  volume: number // 0..1, raw slider position (curve applied at output)
  playingRowId: string | null
  isAudioPlaying: boolean // wavesurfer is actively playing (vs paused)
  currentTime: number
  currentDuration: number
  currentAmp: number // 0..1, smoothed live amplitude

  // mutators
  setConfig: (cfg: Config) => void
  setGenreFolders: (folders: string[]) => void
  addGenreFolder: (name: string) => void
  setLibraryIndex: (names: Set<string>) => void
  setStatus: (msg: string) => void
  setScanning: (b: boolean) => void

  setRows: (rows: RowState[]) => void
  updateRow: (id: string, patch: Partial<RowState>) => void
  removeRow: (id: string) => void

  setVolume: (v: number) => void
  setPlayingRowId: (id: string | null) => void
  setIsAudioPlaying: (b: boolean) => void
  setPlaybackTime: (currentTime: number, duration: number) => void
  setCurrentAmp: (amp: number) => void

  // Modal
  modal: ModalDialog | null
  setModal: (m: ModalDialog | null) => void
}

export const useStore = create<AppState>()((set) => ({
  config: null,
  rows: [],
  genreFolders: [],
  libraryIndex: new Set(),
  scanning: false,
  status: 'Ready',

  volume: 0.7,
  playingRowId: null,
  isAudioPlaying: false,
  currentTime: 0,
  currentDuration: 0,
  currentAmp: 0,

  setConfig: (config) => set({ config }),
  setGenreFolders: (genreFolders) => set({ genreFolders }),
  addGenreFolder: (name) =>
    set((s) => {
      if (s.genreFolders.includes(name)) return s
      const next = [...s.genreFolders, name].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      )
      return { genreFolders: next }
    }),
  setLibraryIndex: (libraryIndex) => set({ libraryIndex }),
  setStatus: (status) => set({ status }),
  setScanning: (scanning) => set({ scanning }),

  setRows: (rows) => set({ rows }),
  updateRow: (id, patch) =>
    set((s) => ({
      rows: s.rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    })),
  removeRow: (id) => set((s) => ({ rows: s.rows.filter((r) => r.id !== id) })),

  setVolume: (volume) => set({ volume }),
  setPlayingRowId: (playingRowId) =>
    set({ playingRowId, isAudioPlaying: playingRowId !== null }),
  setIsAudioPlaying: (isAudioPlaying) => set({ isAudioPlaying }),
  setPlaybackTime: (currentTime, currentDuration) =>
    set({ currentTime, currentDuration }),
  setCurrentAmp: (currentAmp) => set({ currentAmp }),

  modal: null,
  setModal: (modal) => set({ modal })
}))

/** Modal dialogs — single slot, not stacked. */
export type ModalDialog =
  | {
      kind: 'prompt'
      title: string
      label?: string
      placeholder?: string
      initialValue: string
      confirmText?: string
      onConfirm: (value: string) => void
      onCancel: () => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmText?: string
      destructive?: boolean
      onConfirm: () => void
      onCancel: () => void
    }

export function makeInitialRow(file: AudioFile): RowState {
  return {
    id: file.path,
    file,
    artist: null,
    title: null,
    albumArt: null,
    durationSeconds: 0,
    tags: [],
    tagLookupError: null,
    suggestedFolder: null,
    topTag: null,
    folder: '',
    status: 'loading',
    isDuplicate: false,
    skipped: false,
    peaks: null
  }
}
