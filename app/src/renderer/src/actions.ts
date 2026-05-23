/**
 * High-level user actions that mutate state via IPC: move, delete,
 * create folder, batch move, refresh.
 *
 * Uses forward slashes for paths — Node fs normalizes them on both Windows
 * and macOS, so the renderer doesn't need to know the path separator.
 */
import { useStore, makeInitialRow, type RowState } from './store'
import { cancelEnrichment, enrichAll } from './enrich'
import { preloadPeaks } from './peaks'
import { showConfirm, showPrompt } from './dialogs'

function joinForward(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/')
}

interface MoveOpts {
  /** If true, prompts the user when the destination already exists.
   *  If false (batch mode), silently skips duplicates. */
  confirmOverwrite?: boolean
}

export async function moveRow(row: RowState, opts: MoveOpts = {}): Promise<boolean> {
  const { config, setStatus, removeRow } = useStore.getState()
  if (!config || !row.folder) return false

  const destDir = joinForward(config.musicRoot, row.folder)
  const destPath = joinForward(destDir, row.file.name)

  try {
    await window.api.ensureDir(destDir)
    const exists = await window.api.pathExists(destPath)
    if (exists) {
      if (opts.confirmOverwrite) {
        const ok = await showConfirm({
          title: 'File already exists',
          message: `${row.file.name} already exists in ${row.folder}.\n\nOverwrite it?`,
          confirmText: 'Overwrite',
          destructive: true
        })
        if (!ok) return false
        await window.api.deleteFile(destPath)
      } else {
        setStatus(`Skipped (exists): ${row.file.name}`)
        return false
      }
    }
    const result = await window.api.moveFile(row.file.path, destPath)
    if (!result.ok) {
      setStatus(`Move failed: ${result.error}`)
      return false
    }
    setStatus(`Moved → ${row.folder}/${row.file.name}`)
    removeRow(row.id)
    return true
  } catch (err) {
    setStatus(`Move failed: ${(err as Error).message}`)
    return false
  }
}

export async function deleteRow(row: RowState): Promise<boolean> {
  const ok = await showConfirm({
    title: 'Delete file',
    message: `Permanently delete this file?\n\n${row.file.name}\n\nThis can't be undone.`,
    confirmText: 'Delete',
    destructive: true
  })
  if (!ok) return false
  try {
    await window.api.deleteFile(row.file.path)
    useStore.getState().setStatus(`Deleted ${row.file.name}`)
    useStore.getState().removeRow(row.id)
    return true
  } catch (err) {
    useStore.getState().setStatus(`Delete failed: ${(err as Error).message}`)
    return false
  }
}

export async function createFolderForRow(row: RowState): Promise<void> {
  const { config, addGenreFolder, updateRow, setStatus } = useStore.getState()
  if (!config) return
  const suggested = row.topTag ?? ''
  const name = await showPrompt({
    title: 'New genre folder',
    label: 'Folder name',
    placeholder: 'e.g. Synthwave',
    initialValue: suggested,
    confirmText: 'Create'
  })
  if (!name) return
  const clean = name.trim().replace(/^[\\/]+|[\\/]+$/g, '')
  if (!clean) return
  const destDir = joinForward(config.musicRoot, clean)
  try {
    await window.api.ensureDir(destDir)
    addGenreFolder(clean)
    updateRow(row.id, { folder: clean })
    setStatus(`Created folder: ${clean}`)
  } catch (err) {
    setStatus(`Create failed: ${(err as Error).message}`)
  }
}

export async function batchMove(): Promise<void> {
  const { rows, setStatus } = useStore.getState()
  const queued = rows.filter((r) => !r.skipped && r.folder && !r.isDuplicate)
  if (queued.length === 0) {
    setStatus('Nothing to move')
    return
  }
  setStatus(`Moving ${queued.length}…`)
  let moved = 0
  for (const row of queued) {
    const ok = await moveRow(row, { confirmOverwrite: false })
    if (ok) moved++
    await new Promise((r) => setTimeout(r, 60))
  }
  setStatus(`Batch complete — moved ${moved}`)
}

export async function refreshDownloads(): Promise<void> {
  const { config, setRows, setStatus } = useStore.getState()
  if (!config) return
  cancelEnrichment()
  setRows([])
  setStatus('Re-scanning…')
  try {
    const files = await window.api.scanDownloads(
      config.downloadsPath,
      config.scanSubfolders,
      config.audioExtensions
    )
    const initial = files.map(makeInitialRow)
    setRows(initial)
    setStatus(`Loaded ${files.length} file${files.length === 1 ? '' : 's'}`)
    void enrichAll(initial)
    preloadPeaks(initial)
  } catch (err) {
    setStatus(`Refresh failed: ${(err as Error).message}`)
  }
}
