/**
 * Wavesurfer.js bars for the currently-playing row.
 *
 * We pull the audio bytes through IPC (window.api.readFile) and feed
 * wavesurfer a blob URL — using a custom scheme like local-audio:// makes
 * wavesurfer's internal fetch() throw on URL parsing, so blobs sidestep
 * the issue entirely.
 */
import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { useStore } from '../store'
import { audio } from '../audio'

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

function mimeFor(filepath: string): string {
  const dot = filepath.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  const ext = filepath.slice(dot + 1).toLowerCase()
  return MIME_FOR_EXT[ext] || 'application/octet-stream'
}

interface Props {
  rowId: string
  filepath: string
  /** If set, seek to this fraction (0..1) of the track once the audio loads,
   *  before pressing play. Used when the user clicked into the static wave
   *  at a specific position. */
  initialSeek?: number | null
  /** Fired after the initial seek (if any) has been applied. */
  onSeekApplied?: () => void
}

export function Waveform({
  rowId,
  filepath,
  initialSeek,
  onSeekApplied
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    let blobUrl: string | null = null
    let ws: WaveSurfer | null = null
    let cancelled = false

    ;(async () => {
      try {
        const bytes = await window.api.readFile(filepath)
        if (cancelled || !containerRef.current) return
        const blob = new Blob([bytes as BlobPart], { type: mimeFor(filepath) })
        blobUrl = URL.createObjectURL(blob)

        ws = WaveSurfer.create({
          container: containerRef.current,
          waveColor: '#3a3a3a',
          progressColor: '#ffffff',
          cursorColor: '#ffffff',
          cursorWidth: 1,
          barWidth: 3,
          barGap: 2,
          barRadius: 1,
          height: 40,
          normalize: true,
          url: blobUrl
        })

        ws.on('ready', () => {
          if (cancelled || !ws) return
          audio.registerWaveSurfer(ws)
          if (initialSeek != null && initialSeek > 0 && initialSeek < 1) {
            const dur = ws.getDuration()
            if (dur > 0) ws.setTime(initialSeek * dur)
            onSeekApplied?.()
          }
          void ws.play()
        })

        ws.on('play', () => useStore.getState().setIsAudioPlaying(true))
        ws.on('pause', () => useStore.getState().setIsAudioPlaying(false))
        ws.on('timeupdate', (t: number) => {
          if (!ws) return
          useStore.getState().setPlaybackTime(t, ws.getDuration())
        })
        ws.on('finish', () => useStore.getState().setPlayingRowId(null))
        ws.on('error', (err: Error | unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('wavesurfer error', err)
          setErrorMsg(msg)
          useStore.getState().setPlayingRowId(null)
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('audio load failed', err)
        setErrorMsg(msg)
        useStore.getState().setStatus(`Playback failed: ${msg}`)
        useStore.getState().setPlayingRowId(null)
      }
    })()

    return () => {
      cancelled = true
      audio.unregisterWaveSurfer()
      if (ws) {
        try {
          ws.destroy()
        } catch {
          /* destroy can throw if already torn down */
        }
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [rowId, filepath])

  return (
    <div className="pt-2">
      <div ref={containerRef} className="w-full" />
      {errorMsg && (
        <div className="mt-1 text-[10px] text-danger">Playback error: {errorMsg}</div>
      )}
    </div>
  )
}
