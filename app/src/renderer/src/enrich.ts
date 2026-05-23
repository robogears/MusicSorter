/**
 * Background pipeline that walks a list of file paths and fills in their
 * metadata + Last.fm tags + duplicate flag. Sequential with a small delay
 * between Last.fm calls (the shared API key has a ~5/sec rate limit).
 */
import { useStore, type RowState } from './store'
import { suggestFolder } from './genre'

const LASTFM_THROTTLE_MS = 220

const cancellation = { token: 0 }

export function cancelEnrichment(): void {
  cancellation.token++
}

export async function enrichAll(rows: RowState[]): Promise<void> {
  cancellation.token++
  const myToken = cancellation.token
  const api = window.api
  const { updateRow, libraryIndex, genreFolders } = useStore.getState()

  for (const row of rows) {
    if (cancellation.token !== myToken) return

    try {
      const md = await api.readMetadata(row.file.path)
      const patch: Partial<RowState> = {
        artist: md.artist,
        title: md.title,
        albumArt: md.albumArtDataUrl,
        durationSeconds: md.durationSeconds,
        status: 'ready'
      }
      updateRow(row.id, patch)

      // Tag lookup needs artist (and ideally title).
      if (md.artist) {
        const result = await api.getTags(md.artist, md.title || '')
        const { folder, topTag } = suggestFolder(
          result.tags,
          // Pull the *latest* folder list — it may have grown since this
          // row was queued (user can create new folders while we enrich).
          useStore.getState().genreFolders
        )
        updateRow(row.id, {
          tags: result.tags,
          tagLookupError: result.error,
          suggestedFolder: folder,
          topTag,
          folder: folder ?? '',
          tagsChecked: true
        })
      } else {
        // No artist → no point querying Last.fm; flag as "looked up" so the
        // "can't find genre" badge can render instead of staying ambiguous.
        updateRow(row.id, { tagsChecked: true })
      }
    } catch (err) {
      console.error('enrich failed for', row.file.path, err)
    }

    // Duplicate check uses the latest library snapshot — scan may finish
    // between rows.
    const idx = useStore.getState().libraryIndex
    if (idx.has(row.file.name.toLowerCase())) {
      updateRow(row.id, { isDuplicate: true, skipped: true })
    }

    // Peak decoding happens in its own concurrent worker pool — see
    // preloadPeaks() in peaks.ts, kicked off from App.tsx alongside this
    // enrichment loop.

    if (cancellation.token !== myToken) return
    await new Promise((r) => setTimeout(r, LASTFM_THROTTLE_MS))
  }

  // touch `genreFolders` / `libraryIndex` so eslint doesn't warn about the
  // unused destructure above.
  void genreFolders
  void libraryIndex
}
