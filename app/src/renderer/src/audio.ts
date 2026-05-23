/**
 * AudioManager — singleton that owns the currently-playing HTMLAudioElement.
 *
 * Reads bytes via window.api.readFile, wraps in a Blob (custom schemes break
 * fetch — see CLAUDE.md), and plays via a fresh <audio> element each time.
 * Routes through a Web Audio AnalyserNode so the dancing-dude can react to
 * live amplitude (~20 Hz sampling).
 *
 * Per-track blob URLs are kept in a small LRU so re-clicks are instant.
 */
import { useStore } from './store'

const VOLUME_CURVE_POW = 3.0
const AMP_INTERVAL_MS = 50
const MAX_CACHE = 3

const MIME_FOR_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp4: 'audio/mp4'
}

function curvedVolume(slider: number): number {
  return Math.max(0, Math.min(1, slider)) ** VOLUME_CURVE_POW
}

function mimeFor(filepath: string): string {
  const dot = filepath.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  return MIME_FOR_EXT[filepath.slice(dot + 1).toLowerCase()] || 'application/octet-stream'
}

interface CacheEntry {
  blobUrl: string
}

class AudioManager {
  private el: HTMLAudioElement | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private ampTimer: number | null = null
  private ampBuf: Uint8Array<ArrayBuffer> | null = null
  private cache = new Map<string, CacheEntry>()
  private currentPath: string | null = null

  private ensureContext(): void {
    if (this.context) return
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    analyser.connect(ctx.destination)
    this.context = ctx
    this.analyser = analyser
    this.ampBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
  }

  private async getBlobUrl(filepath: string): Promise<string> {
    const hit = this.cache.get(filepath)
    if (hit) {
      // LRU bump: re-insert moves the entry to the end of iteration order.
      this.cache.delete(filepath)
      this.cache.set(filepath, hit)
      return hit.blobUrl
    }
    const bytes = await window.api.readFile(filepath)
    const blob = new Blob([bytes as BlobPart], { type: mimeFor(filepath) })
    const blobUrl = URL.createObjectURL(blob)
    this.cache.set(filepath, { blobUrl })
    this.evictOld(filepath)
    return blobUrl
  }

  private evictOld(keepPath: string): void {
    while (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      // Don't evict the just-inserted entry or the currently-playing one.
      if (oldest === keepPath || oldest === this.currentPath) {
        const e = this.cache.get(oldest)
        if (!e) return
        this.cache.delete(oldest)
        this.cache.set(oldest, e)
        continue
      }
      const e = this.cache.get(oldest)
      if (e) URL.revokeObjectURL(e.blobUrl)
      this.cache.delete(oldest)
    }
  }

  async play(filepath: string, seekFraction = 0): Promise<void> {
    this.ensureContext()
    if (!this.context || !this.analyser) return

    this.tearDown()

    try {
      const blobUrl = await this.getBlobUrl(filepath)
      const el = new Audio(blobUrl)
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.volume = curvedVolume(useStore.getState().volume)

      // Each <audio> element can only be sourced by one MediaElementSourceNode
      // ever — that's why we create a fresh element per play.
      const source = this.context.createMediaElementSource(el)
      source.connect(this.analyser)

      this.el = el
      this.source = source
      this.currentPath = filepath

      el.addEventListener('play', () => {
        useStore.getState().setIsAudioPlaying(true)
        this.startAmpTimer()
      })
      el.addEventListener('pause', () => {
        useStore.getState().setIsAudioPlaying(false)
        this.stopAmpTimer()
      })
      el.addEventListener('timeupdate', () => {
        useStore.getState().setPlaybackTime(el.currentTime, el.duration || 0)
      })
      el.addEventListener('ended', () => {
        useStore.getState().setPlayingRowId(null)
      })
      el.addEventListener('error', () => {
        const msg = el.error?.message || 'unknown error'
        useStore.getState().setStatus(`Playback failed: ${msg}`)
        useStore.getState().setPlayingRowId(null)
      })

      if (seekFraction > 0 && seekFraction < 1) {
        const applySeek = (): void => {
          if (el.duration > 0 && isFinite(el.duration)) {
            el.currentTime = seekFraction * el.duration
          }
        }
        if (el.readyState >= 1) applySeek()
        else el.addEventListener('loadedmetadata', applySeek, { once: true })
      }

      await el.play()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      useStore.getState().setStatus(`Playback failed: ${msg}`)
      useStore.getState().setPlayingRowId(null)
      this.tearDown()
    }
  }

  private tearDown(): void {
    this.stopAmpTimer()
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        /* ignore */
      }
      this.source = null
    }
    if (this.el) {
      try {
        this.el.pause()
      } catch {
        /* ignore */
      }
      try {
        // Drop the src so the browser releases its reference to the Blob.
        this.el.removeAttribute('src')
        this.el.load()
      } catch {
        /* ignore */
      }
      this.el = null
    }
    this.currentPath = null
  }

  /** Stop playback and reset all derived store state. */
  stop(): void {
    this.tearDown()
    const s = useStore.getState()
    s.setCurrentAmp(0)
    s.setPlaybackTime(0, 0)
    s.setIsAudioPlaying(false)
    s.setPlayingRowId(null)
  }

  togglePlay(): void {
    if (!this.el) return
    if (this.el.paused) void this.el.play()
    else this.el.pause()
  }

  /** Set playhead to `fraction` (0..1) of the current track. Audio keeps
   *  playing through the change — that's the "skim" effect. */
  seekFraction(fraction: number): void {
    if (!this.el) return
    const dur = this.el.duration
    if (!isFinite(dur) || dur <= 0) return
    this.el.currentTime = Math.max(0, Math.min(dur, fraction * dur))
  }

  applyVolume(): void {
    if (this.el) this.el.volume = curvedVolume(useStore.getState().volume)
  }

  private startAmpTimer(): void {
    this.stopAmpTimer()
    this.ampTimer = window.setInterval(() => {
      if (!this.analyser || !this.ampBuf) return
      this.analyser.getByteTimeDomainData(this.ampBuf)
      let sum = 0
      for (let i = 0; i < this.ampBuf.length; i++) {
        sum += Math.abs(this.ampBuf[i] - 128)
      }
      const amp = sum / this.ampBuf.length / 128
      useStore.getState().setCurrentAmp(amp)
    }, AMP_INTERVAL_MS)
  }

  private stopAmpTimer(): void {
    if (this.ampTimer !== null) {
      window.clearInterval(this.ampTimer)
      this.ampTimer = null
    }
  }
}

export const audio = new AudioManager()

useStore.subscribe((state, prev) => {
  if (state.volume !== prev.volume) audio.applyVolume()
})
