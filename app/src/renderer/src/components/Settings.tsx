/**
 * Settings modal — mirrors the robogears Downloader's settings layout.
 *
 * On save: persists config.json, then re-runs whichever scans are now
 * stale (library if music root changed, queue if downloads changed).
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { refreshDownloads } from '../actions'

interface Props {
  onClose: () => void
}

export function Settings({ onClose }: Props): React.JSX.Element {
  const config = useStore((s) => s.config)
  const setConfig = useStore((s) => s.setConfig)
  const setGenreFolders = useStore((s) => s.setGenreFolders)
  const setLibraryIndex = useStore((s) => s.setLibraryIndex)
  const setStatus = useStore((s) => s.setStatus)

  const [downloadsPath, setDownloadsPath] = useState(config?.downloadsPath ?? '')
  const [musicRoot, setMusicRoot] = useState(config?.musicRoot ?? '')
  const [scanSubfolders, setScanSubfolders] = useState(config?.scanSubfolders ?? false)
  const [indexed, setIndexed] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Initial folder count for the indexed display.
  useEffect(() => {
    if (!musicRoot) {
      setIndexed(null)
      return
    }
    let cancelled = false
    window.api.listGenreFolders(musicRoot).then((folders) => {
      if (!cancelled) setIndexed(folders.length)
    })
    return () => {
      cancelled = true
    }
  }, [musicRoot])

  async function pick(setter: (s: string) => void, title: string): Promise<void> {
    const p = await window.api.pickFolder(title)
    if (p) setter(p)
  }

  async function refreshIndexed(): Promise<void> {
    if (!musicRoot) return
    const folders = await window.api.listGenreFolders(musicRoot)
    setIndexed(folders.length)
  }

  async function onSave(): Promise<void> {
    if (!config) return
    const trimmedDl = downloadsPath.trim()
    const trimmedMusic = musicRoot.trim()
    if (!trimmedDl || !trimmedMusic) {
      setStatus('Both folders must be set before saving.')
      return
    }
    setSaving(true)
    try {
      const exts = config.audioExtensions
      const next = {
        downloadsPath: trimmedDl,
        musicRoot: trimmedMusic,
        scanSubfolders,
        audioExtensions: exts
      }
      await window.api.saveConfig(next)
      setConfig(next)

      const musicChanged = next.musicRoot !== config.musicRoot
      const downloadsChanged =
        next.downloadsPath !== config.downloadsPath ||
        next.scanSubfolders !== config.scanSubfolders

      if (musicChanged) {
        const [folders, libNames] = await Promise.all([
          window.api.listGenreFolders(next.musicRoot),
          window.api.scanLibrary(next.musicRoot, exts)
        ])
        setGenreFolders(folders)
        setLibraryIndex(new Set(libNames))
      }
      if (downloadsChanged) {
        await refreshDownloads()
      }
      setStatus('Settings saved.')
      onClose()
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[680px] max-w-[95vw] rounded-2xl bg-surface-1 p-7 shadow-2xl ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center">
          <h2 className="text-lg font-bold tracking-tight text-text">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-text-muted transition hover:bg-surface-3 hover:text-text"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Download folder */}
        <div className="mb-6">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Download folder
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={downloadsPath}
              onChange={(e) => setDownloadsPath(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-text outline-none focus:border-border-bright"
              placeholder="C:\Users\…\Downloads"
            />
            <button
              type="button"
              onClick={() => pick(setDownloadsPath, 'Pick Downloads folder')}
              className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs font-bold text-text transition-colors hover:bg-surface-3"
            >
              Browse…
            </button>
          </div>
          <p className="mt-2 text-[11px] text-text-dim">
            Where MusicSorter scans for new music to sort.
          </p>
        </div>

        {/* Music library folder */}
        <div className="mb-6">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Music library folder
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={musicRoot}
              onChange={(e) => setMusicRoot(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-text outline-none focus:border-border-bright"
              placeholder="C:\Users\…\Music"
            />
            <button
              type="button"
              onClick={() => pick(setMusicRoot, 'Pick music root folder')}
              className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs font-bold text-text transition-colors hover:bg-surface-3"
            >
              Browse…
            </button>
            <button
              type="button"
              onClick={() => setMusicRoot('')}
              className="rounded-lg px-3 py-2.5 text-xs font-bold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
            >
              Clear
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3 text-[11px] font-bold text-text-muted">
            <span>
              {indexed === null ? '— ' : `${indexed} `}genre folders indexed
            </span>
            <button
              type="button"
              onClick={refreshIndexed}
              className="rounded-md px-2 py-0.5 font-bold text-text-muted hover:bg-surface-3 hover:text-text"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-[11px] text-text-dim">
            Destination for moved files. Each subfolder is a genre.
          </p>
        </div>

        {/* Scan subfolders */}
        <label className="mb-6 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={scanSubfolders}
            onChange={(e) => setScanSubfolders(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          <span className="text-sm text-text">Scan subfolders of Downloads</span>
        </label>

        {/* Done */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-accent px-6 py-2.5 text-sm font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
