/**
 * AudioManager — coordinator for the currently-active wavesurfer instance.
 *
 * The Waveform React component owns the wavesurfer lifecycle (creates it on
 * mount, destroys it on unmount). On 'ready' it calls `registerWaveSurfer`,
 * which wires the underlying media element into a Web Audio AnalyserNode so
 * the dancing dude can react to live amplitude.
 */
import type WaveSurfer from 'wavesurfer.js'
import { useStore } from './store'

const VOLUME_CURVE_POW = 3.0
const AMP_INTERVAL_MS = 50

function curvedVolume(slider: number): number {
  return Math.max(0, Math.min(1, slider)) ** VOLUME_CURVE_POW
}

export function audioUrl(filepath: string): string {
  const normalized = filepath.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `local-audio:///${encoded}`
}

class AudioManager {
  private ws: WaveSurfer | null = null
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private ampTimer: number | null = null
  private ampBuf: Uint8Array<ArrayBuffer> | null = null

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

  /** Called by Waveform on 'ready'. Hooks volume + analyser. */
  registerWaveSurfer(ws: WaveSurfer): void {
    this.ensureContext()
    this.ws = ws
    ws.setVolume(curvedVolume(useStore.getState().volume))

    const media = ws.getMediaElement()
    if (media && this.context && this.analyser) {
      try {
        media.crossOrigin = 'anonymous'
        const source = this.context.createMediaElementSource(media)
        source.connect(this.analyser)
        this.source = source
      } catch (err) {
        console.warn('analyser hookup failed:', err)
      }
    }
    this.startAmpTimer()
  }

  /** Called by Waveform on unmount or destroy. */
  unregisterWaveSurfer(): void {
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        /* noop */
      }
      this.source = null
    }
    this.ws = null
    this.stopAmpTimer()
    const s = useStore.getState()
    s.setCurrentAmp(0)
    s.setPlaybackTime(0, 0)
  }

  togglePlay(): void {
    if (!this.ws) return
    if (this.ws.isPlaying()) this.ws.pause()
    else void this.ws.play()
  }

  applyVolume(): void {
    if (this.ws) this.ws.setVolume(curvedVolume(useStore.getState().volume))
  }
}

export const audio = new AudioManager()

// Live-update wavesurfer volume whenever the slider changes.
useStore.subscribe((state, prev) => {
  if (state.volume !== prev.volume) audio.applyVolume()
})
