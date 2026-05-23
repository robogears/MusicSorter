/**
 * Decode an audio file (via IPC bytes) and downsample it to N peaks for
 * the static waveform display.
 *
 * `computePeaks` does one file at a time (no cache check).
 * `preloadPeaks` runs a small worker pool over a row list AND first hydrates
 * the store from a localStorage cache so previously-decoded waveforms appear
 * instantly on launch/refresh — only new/changed files need fresh decode.
 *
 * Cache is keyed by filepath + mtime; if either changes the entry is
 * invalidated and recomputed.
 */
import { useStore, type RowState } from './store'

const PEAKS_CONCURRENCY = 4
const PEAKS_CACHE_KEY = 'musicsorter:peaks:v1'

interface CacheEntry {
  mtime: number
  peaks: number[]
}

type Cache = Record<string, CacheEntry>

let cache: Cache | null = null

function loadCache(): Cache {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(PEAKS_CACHE_KEY)
    cache = raw ? (JSON.parse(raw) as Cache) : {}
  } catch {
    cache = {}
  }
  return cache
}

let cacheSaveTimer: number | null = null

function scheduleCacheSave(): void {
  // Coalesce writes — preload pumps dozens of saves in a tight window.
  if (cacheSaveTimer !== null) return
  cacheSaveTimer = window.setTimeout(() => {
    cacheSaveTimer = null
    try {
      window.localStorage.setItem(PEAKS_CACHE_KEY, JSON.stringify(loadCache()))
    } catch {
      // quota exceeded or storage unavailable — just skip; next attempt
      // will retry from a fresh batch of decoded peaks.
    }
  }, 300)
}

function cacheGet(filepath: string, mtime: number, nBars: number): number[] | null {
  const entry = loadCache()[filepath]
  if (!entry || entry.mtime !== mtime || entry.peaks.length !== nBars) {
    return null
  }
  return entry.peaks
}

function cacheSet(filepath: string, mtime: number, peaks: number[]): void {
  loadCache()[filepath] = { mtime, peaks }
  scheduleCacheSave()
}

/**
 * Decode bytes → mono AudioBuffer using OfflineAudioContext. We pick offline
 * because it doesn't require the user-gesture autoplay policy that a regular
 * AudioContext might (and we never need to play through it anyway).
 */
async function decodeBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  // decodeAudioData detaches the buffer it's given — copy first so the
  // original Uint8Array view stays intact for any other consumer.
  const sliced = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  // A 1-channel, 1-sample, 44.1 kHz context is the cheapest legal config —
  // the actual decode uses the source file's properties, not these.
  const ctx = new OfflineAudioContext(1, 1, 44100)
  return ctx.decodeAudioData(sliced)
}

/**
 * Try Chromium's native decoder first (fast). On failure (FLAC variant
 * Chromium can't handle, etc.) fall back to audio-decode in the main process.
 */
export async function computePeaks(
  filepath: string,
  nBars = 60
): Promise<number[] | null> {
  // Pass 1: renderer (Chromium native, fast)
  try {
    const bytes = await window.api.readFile(filepath)
    const buf = await decodeBytes(bytes)

    const ch0 = buf.getChannelData(0)
    const chunk = Math.max(1, Math.floor(ch0.length / nBars))
    const peaks: number[] = new Array(nBars).fill(0)
    let globalMax = 0

    for (let i = 0; i < nBars; i++) {
      const start = i * chunk
      const end = Math.min(start + chunk, ch0.length)
      let max = 0
      for (let j = start; j < end; j++) {
        const a = Math.abs(ch0[j])
        if (a > max) max = a
      }
      peaks[i] = max
      if (max > globalMax) globalMax = max
    }

    if (globalMax === 0) return peaks
    return peaks.map((p) => p / globalMax)
  } catch (rendererErr) {
    console.warn('[peaks] renderer decode failed, falling back to main:', filepath, rendererErr)
  }

  // Pass 2: main process (audio-decode, supports formats Chromium can't)
  try {
    const fromMain = await window.api.computePeaks(filepath, nBars)
    if (fromMain) {
      console.log('[peaks] main-process fallback succeeded for', filepath)
    }
    return fromMain
  } catch (mainErr) {
    console.error('[peaks] main decode also failed:', filepath, mainErr)
    return null
  }
}

/**
 * Decode peaks for every row in parallel batches (default 4 at a time) and
 * patch them into the store as they land. Skips rows that already have peaks
 * (lets it be called again safely after a Refresh / re-scan).
 *
 * Returns a token. Cancelling that token stops the workers between files
 * (the currently-in-flight decode still finishes — there's no API to abort
 * decodeAudioData mid-call). Use cancel() when switching to a new file list.
 */
export interface PeaksPreloadHandle {
  cancel: () => void
}

export function preloadPeaks(rows: RowState[]): PeaksPreloadHandle {
  const NBARS = 60
  const store = useStore.getState()
  const needsDecode: RowState[] = []

  // 1) Hydrate from cache synchronously so anything decoded previously
  //    paints its real waveform on the very first frame.
  let fromCache = 0
  for (const row of rows) {
    if (row.peaks) continue
    const cached = cacheGet(row.file.path, row.file.modifiedMs, NBARS)
    if (cached) {
      store.updateRow(row.id, { peaks: cached })
      fromCache++
    } else {
      needsDecode.push(row)
    }
  }
  console.log(
    `[peaks] preload start — ${rows.length} rows, ${fromCache} from cache, ${needsDecode.length} to decode`
  )

  // 2) Decode the rest in a small concurrent worker pool.
  let cursor = 0
  let cancelled = false
  let decoded = 0
  let failed = 0

  async function worker(workerId: number): Promise<void> {
    while (!cancelled && cursor < needsDecode.length) {
      const idx = cursor++
      const row = needsDecode[idx]
      try {
        const peaks = await computePeaks(row.file.path, NBARS)
        if (cancelled) return
        if (peaks) {
          cacheSet(row.file.path, row.file.modifiedMs, peaks)
          const live = useStore.getState().rows.find((r) => r.id === row.id)
          if (live) useStore.getState().updateRow(row.id, { peaks })
          decoded++
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.error('[peaks] worker', workerId, 'failed for', row.file.path, err)
      }
    }
  }

  const workerCount = Math.max(1, Math.min(PEAKS_CONCURRENCY, needsDecode.length))
  Promise.all(
    Array.from({ length: workerCount }, (_, i) => worker(i))
  ).then(() => {
    if (!cancelled) {
      console.log(
        `[peaks] preload done — decoded ${decoded}, failed ${failed}, from cache ${fromCache}`
      )
    }
  })

  return {
    cancel: () => {
      cancelled = true
    }
  }
}
