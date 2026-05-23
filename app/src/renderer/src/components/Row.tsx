/**
 * Single track row — playback button, metadata, controls, all stitched.
 */
import { useState } from 'react'
import { useStore, type RowState } from '../store'
import { createFolderForRow, deleteRow, moveRow } from '../actions'
import { audio } from '../audio'
import { Waveform } from './Waveform'
import { StaticWave } from './StaticWave'

const PLAYABLE_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.mp4'])

function chipClasses(weight: number): string {
  if (weight >= 70) return 'bg-[#e8e8e8] text-[#0a0a0a]'
  if (weight >= 40) return 'bg-surface-4 text-[#dadada]'
  if (weight >= 15) return 'bg-surface-3 text-text-muted'
  return 'bg-[#181818] text-text-dim'
}

interface Props {
  row: RowState
}

export function Row({ row }: Props): React.JSX.Element {
  const updateRow = useStore((s) => s.updateRow)
  const folders = useStore((s) => s.genreFolders)
  const playingRowId = useStore((s) => s.playingRowId)
  const isAudioPlaying = useStore((s) => s.isAudioPlaying)
  const [removing, setRemoving] = useState<'move' | 'delete' | null>(null)
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)

  const isPlaying = playingRowId === row.id
  const dimmed = (row.skipped || row.isDuplicate) && !removing
  const ext = row.file.name.slice(row.file.name.lastIndexOf('.')).toLowerCase()
  const canPlay = PLAYABLE_EXTS.has(ext)
  const extLabel = ext.slice(1).toUpperCase()

  async function onMove(): Promise<void> {
    if (!row.folder || removing) return
    setRemoving('move')
    await moveRow(row, { confirmOverwrite: true })
  }

  async function onDelete(): Promise<void> {
    if (removing) return
    setRemoving('delete')
    const ok = await deleteRow(row)
    if (!ok) setRemoving(null)
  }

  function onPlay(): void {
    if (!canPlay) {
      useStore.getState().setStatus(`Preview not supported for ${ext}`)
      return
    }
    if (isPlaying) {
      audio.togglePlay()
    } else {
      setPendingSeek(null)
      useStore.getState().setPlayingRowId(row.id)
    }
  }

  function onStaticWaveClick(fraction: number): void {
    if (!canPlay) {
      useStore.getState().setStatus(`Preview not supported for ${ext}`)
      return
    }
    setPendingSeek(fraction)
    useStore.getState().setPlayingRowId(row.id)
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-transparent transition-all duration-200 ${
        removing === 'move'
          ? 'bg-success-flash opacity-0'
          : removing === 'delete'
            ? 'bg-danger-flash opacity-0'
            : isPlaying
              ? 'bg-surface-2 ring-1 ring-text/20'
              : dimmed
                ? 'bg-bg'
                : 'bg-surface-2'
      }`}
    >
      <div className="flex gap-4 p-4">
        {/* Art */}
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3">
          {row.albumArt ? (
            <img
              src={row.albumArt}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="font-mono text-xs text-text-dim">{extLabel}</span>
          )}
        </div>

        {/* Info column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className={`text-xs ${dimmed ? 'text-text-dim' : 'text-text-muted'}`}>
            {row.artist ?? (row.status === 'loading' ? 'Loading…' : '(no artist)')}
          </div>
          <div
            className={`truncate text-base font-bold ${
              dimmed ? 'text-text-dim line-through decoration-text-dim' : 'text-text'
            }`}
          >
            {row.title ?? row.file.name}
          </div>
          <div className="truncate text-[10px] text-text-dim">{row.file.name}</div>

          {row.isDuplicate && (
            <div className="mt-1">
              <span className="rounded-md bg-dup-bg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-dup-fg">
                Already in library
              </span>
            </div>
          )}

          {row.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {row.tags.slice(0, 5).map((t) => (
                <span
                  key={t.name}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${chipClasses(t.weight)}`}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {row.tagLookupError && row.tags.length === 0 && (
            <div className="mt-1 text-[10px] text-danger">
              Last.fm lookup failed: {row.tagLookupError}
            </div>
          )}

          {row.suggestedFolder && (
            <div className="mt-1 text-[11px] text-success">
              Suggested: <span className="font-bold">{row.suggestedFolder}</span>
              {row.topTag && <span className="ml-2 text-text-dim">tag: {row.topTag}</span>}
            </div>
          )}

          {!row.suggestedFolder && row.topTag && row.tags.length > 0 && (
            <div className="mt-1 text-[11px] text-warning">
              No folder match for tag <span className="font-bold">{row.topTag}</span>
              {' '}— pick one below or click + New
            </div>
          )}
        </div>

        {/* Top-right action stack: just skip now (play moved below) */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            className={`rounded-lg border border-border px-3 py-1.5 text-xs font-bold transition-colors ${
              row.skipped
                ? 'text-text hover:bg-surface-3'
                : 'text-text-muted hover:bg-surface-3 hover:text-text'
            }`}
            onClick={() => updateRow(row.id, { skipped: !row.skipped })}
          >
            {row.skipped ? (row.isDuplicate ? 'Add' : 'Undo') : 'Skip'}
          </button>
        </div>
      </div>

      {/* Play + waveform row — always present, even when nothing's playing */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <button
          type="button"
          onClick={onPlay}
          disabled={!canPlay}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface-3 text-base text-text transition-colors hover:bg-surface-4 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={isPlaying && isAudioPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying && isAudioPlaying ? '⏸' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          {isPlaying ? (
            <Waveform
              rowId={row.id}
              filepath={row.file.path}
              initialSeek={pendingSeek}
              onSeekApplied={() => setPendingSeek(null)}
            />
          ) : (
            <StaticWave
              seed={row.file.path}
              peaks={row.peaks}
              onClickAt={canPlay ? onStaticWaveClick : undefined}
            />
          )}
        </div>
      </div>

      {/* Bottom control strip */}
      <div className="flex flex-wrap items-center gap-2 border-t border-surface-3 px-4 py-3">
        <select
          value={row.folder}
          onChange={(e) => updateRow(row.id, { folder: e.target.value })}
          className="rounded-lg border border-border bg-surface-3 px-3 py-2 text-xs text-text outline-none focus:border-border-bright"
        >
          <option value="">— Pick a folder —</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="rounded-lg bg-surface-3 px-3 py-2 text-xs font-bold text-text transition-colors hover:bg-surface-4"
          onClick={() => createFolderForRow(row)}
        >
          + New
        </button>

        <div className="grow" />

        <button
          type="button"
          disabled={!!removing}
          className="rounded-lg border border-danger px-3 py-2 text-xs font-bold text-danger transition-colors hover:bg-danger-hover disabled:opacity-40"
          onClick={onDelete}
        >
          Delete
        </button>

        <button
          type="button"
          disabled={!row.folder || !!removing || row.skipped}
          className="rounded-lg border border-border-bright bg-surface-3 px-3 py-2 text-xs font-bold text-text transition-colors hover:bg-surface-4 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onMove}
        >
          Move →
        </button>
      </div>
    </div>
  )
}
