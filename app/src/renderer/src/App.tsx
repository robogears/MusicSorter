/**
 * App shell. Loads config + folder list + downloads list on mount, then runs
 * the enrichment pipeline in the background.
 */
import { useEffect, useMemo, useState } from 'react'
import { useStore, makeInitialRow } from './store'
import { enrichAll } from './enrich'
import { preloadPeaks } from './peaks'
import { batchMove, refreshDownloads } from './actions'
import { Row } from './components/Row'
import { Dude } from './components/Dude'
import { VolumeSlider } from './components/VolumeSlider'
import { Settings } from './components/Settings'
import { ModalHost } from './components/Dialogs'

const APP_VERSION = '0.2.0-dev'

export default function App(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const rows = useStore((s) => s.rows)
  const status = useStore((s) => s.status)
  const scanning = useStore((s) => s.scanning)
  const setConfig = useStore((s) => s.setConfig)
  const setRows = useStore((s) => s.setRows)
  const setGenreFolders = useStore((s) => s.setGenreFolders)
  const setLibraryIndex = useStore((s) => s.setLibraryIndex)
  const setStatus = useStore((s) => s.setStatus)
  const setScanning = useStore((s) => s.setScanning)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Initial load + scan.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setScanning(true)
      try {
        const cfg = await window.api.loadConfig()
        if (cancelled) return
        setConfig(cfg)

        const [folders, files] = await Promise.all([
          window.api.listGenreFolders(cfg.musicRoot),
          window.api.scanDownloads(cfg.downloadsPath, cfg.scanSubfolders, cfg.audioExtensions)
        ])
        if (cancelled) return
        setGenreFolders(folders)
        const initial = files.map(makeInitialRow)
        setRows(initial)
        setStatus(`Loaded ${files.length} file${files.length === 1 ? '' : 's'}`)

        // Library scan in parallel — duplicates get flagged as enrichment
        // catches up, and any rows already processed get re-checked.
        window.api.scanLibrary(cfg.musicRoot, cfg.audioExtensions).then((names) => {
          if (cancelled) return
          const idx = new Set(names)
          setLibraryIndex(idx)
          // Catch-up: flag duplicates on already-loaded rows.
          const store = useStore.getState()
          for (const r of store.rows) {
            if (!r.isDuplicate && idx.has(r.file.name.toLowerCase())) {
              store.updateRow(r.id, { isDuplicate: true, skipped: true })
            }
          }
          setStatus(`Library indexed: ${names.length} tracks`)
        })

        void enrichAll(initial)
        // Decode waveform peaks in parallel batches so the bars stop being
        // placeholders within a few seconds, not minutes.
        preloadPeaks(initial)
      } catch (err) {
        setStatus(`Init failed: ${(err as Error).message}`)
      } finally {
        if (!cancelled) setScanning(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setConfig, setGenreFolders, setLibraryIndex, setRows, setScanning, setStatus])

  // Memoize derived counts — these can recompute on every keystroke otherwise.
  const queuedCount = useMemo(
    () => rows.filter((r) => !r.skipped && r.folder && !r.isDuplicate).length,
    [rows]
  )
  const remainingCount = useMemo(() => rows.filter((r) => !r.skipped).length, [rows])

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-5">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-surface-3 font-mono text-xs font-bold">
          ♪
        </div>
        <div className="text-lg font-bold tracking-tight">robogears MusicSorter</div>
        <div className="text-[11px] font-medium text-[#c1a87a]">v{APP_VERSION}</div>
        <div className="ml-auto flex items-center gap-4">
          <VolumeSlider />
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md text-text-muted transition hover:bg-surface-3 hover:text-text"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <span className="text-base">⚙</span>
          </button>
        </div>
      </header>

      {/* Queue header */}
      <div className="flex items-center justify-between px-6 pt-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Queue
          </span>
          <button
            type="button"
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-muted hover:bg-surface-3 hover:text-text"
            onClick={() => refreshDownloads()}
          >
            Refresh
          </button>
        </div>
        <div className="text-[10px] text-text-muted">
          {scanning
            ? 'Scanning…'
            : `${remainingCount} remaining · ${rows.length} total`}
        </div>
      </div>

      {/* Top move bar */}
      <div className="flex items-center gap-3 px-6 py-3">
        <button
          type="button"
          disabled={queuedCount === 0}
          onClick={() => batchMove()}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Move {queuedCount} track{queuedCount === 1 ? '' : 's'} →
        </button>
        <span className="text-[10px] text-text-muted">{queuedCount} queued</span>
      </div>

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-6">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 pb-12">
            <Dude />
            <p className="text-xs uppercase tracking-widest text-text-muted">
              {scanning
                ? 'Scanning your downloads…'
                : config
                  ? 'No audio files found'
                  : 'Loading…'}
            </p>
            {config && !scanning && rows.length === 0 && (
              <p className="text-sm text-text-dim">{config.downloadsPath}</p>
            )}
          </div>
        ) : (
          <div
            className="grid gap-3 pb-12"
            // Fixed 3 columns. Cards keep their existing proportions; only the
            // available width per card shrinks as the window narrows.
            style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
          >
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </div>
        )}
      </main>

      {/* Bottom move bar */}
      {rows.length > 0 && (
        <div className="border-t border-border px-6 py-3">
          <button
            type="button"
            disabled={queuedCount === 0}
            onClick={() => batchMove()}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Move {queuedCount} track{queuedCount === 1 ? '' : 's'} →
          </button>
        </div>
      )}

      {/* Activity footer */}
      <footer className="border-t border-border px-6 py-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
          Activity
        </div>
        <div className="mt-1 font-mono text-[11px] text-text">{status}</div>
      </footer>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      <ModalHost />
    </div>
  )
}
