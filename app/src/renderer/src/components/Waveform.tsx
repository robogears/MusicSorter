/**
 * Single canvas-based waveform — handles both idle and playing states.
 *
 * - Bars: decoded peaks when available, filename-seeded placeholder otherwise.
 * - Hover: bars within SPOTLIGHT_RANGE of the cursor swell up; thin vertical
 *   cursor line tracks the mouse.
 * - Click + drag: scrubs continuously. If audio is already playing, the seek
 *   is live (skim effect, audio keeps playing). If not, releasing starts
 *   playback at the released fraction.
 * - DPR-aware: bitmap resized to physical pixels so bars stay sharp on retina.
 *
 * Only the currently-playing row subscribes to currentTime/currentDuration —
 * non-playing rows get a constant 0 from the selector and don't re-render on
 * the 4 Hz `timeupdate` cycle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type RowState } from '../store'
import { audio } from '../audio'

const NBARS = 60
const SPOTLIGHT_RANGE = 10
const SPOTLIGHT_BOOST = 0.45

const PLAYED_COLOR = '#ffffff'
const UNPLAYED_COLOR = '#5a5a5a'
const PLACEHOLDER_COLOR = '#1a1a1a'
const HOVER_PREVIEW_COLOR = '#aaaaaa'
const CURSOR_LINE_COLOR = 'rgba(255, 255, 255, 0.55)'

interface Props {
  row: RowState
  canPlay: boolean
  /** Called when the user releases a click on the canvas while no audio is
   *  playing for this row. The fraction is 0..1 within the canvas width. */
  onPlayAt: (fraction: number) => void
}

function placeholderHeights(seed: string, n: number): number[] {
  let s = 0
  for (let i = 0; i < seed.length; i++) {
    s = ((s << 5) - s + seed.charCodeAt(i)) | 0
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out.push(0.2 + ((s >> 8) % 75) / 100)
  }
  return out
}

interface DrawArgs {
  bars: number[]
  progress: number
  hover: number
  isReal: boolean
  isPlaying: boolean
}

function drawWaveform(canvas: HTMLCanvasElement, args: DrawArgs): void {
  const { bars, progress, hover, isReal, isPlaying } = args
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (cssW === 0 || cssH === 0) return
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
  }
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssW, cssH)

  const n = bars.length
  const slot = cssW / n
  const barW = Math.max(2, slot * 0.7)
  const midY = cssH / 2
  const maxH = cssH - 4
  const hoverBar = hover >= 0 ? hover * n : -1
  const baseUnplayed = isReal ? UNPLAYED_COLOR : PLACEHOLDER_COLOR

  for (let i = 0; i < n; i++) {
    const x = i * slot + (slot - barW) / 2
    const barCenter = i + 0.5
    const playedFracOfBar = barCenter / n

    let boost = 1
    if (hoverBar >= 0) {
      const dist = Math.abs(i - hoverBar)
      if (dist < SPOTLIGHT_RANGE) {
        boost = 1 + (1 - dist / SPOTLIGHT_RANGE) * SPOTLIGHT_BOOST
      }
    }

    const h = Math.min(maxH, Math.max(2, bars[i] * maxH * boost))

    let color = baseUnplayed
    if (isPlaying && playedFracOfBar <= progress) {
      color = PLAYED_COLOR
    } else if (hoverBar >= 0) {
      const dist = i - hoverBar
      if (Math.abs(dist) < 0.5) color = PLAYED_COLOR
      else if (dist < 0) color = HOVER_PREVIEW_COLOR
    }

    ctx.fillStyle = color
    ctx.fillRect(x, midY - h / 2, barW, h)
  }

  if (hover >= 0) {
    ctx.fillStyle = CURSOR_LINE_COLOR
    ctx.fillRect(Math.floor(hover * cssW), 2, 1, cssH - 4)
  }

  ctx.restore()
}

export function Waveform({ row, canPlay, onPlayAt }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // These selectors return 0 when this row isn't the playing one, so the
  // component only re-renders on timeupdate for the currently-playing row.
  const isPlaying = useStore((s) => s.playingRowId === row.id)
  const currentTime = useStore((s) => (s.playingRowId === row.id ? s.currentTime : 0))
  const currentDuration = useStore((s) =>
    s.playingRowId === row.id ? s.currentDuration : 0
  )

  const placeholderRef = useRef<number[] | null>(null)
  if (placeholderRef.current === null) {
    placeholderRef.current = placeholderHeights(row.file.path, NBARS)
  }

  const bars = useMemo(() => {
    if (row.peaks && row.peaks.length > 0) {
      return row.peaks.map((p) => Math.max(0.04, p))
    }
    return placeholderRef.current!
  }, [row.peaks])

  const isReal = !!(row.peaks && row.peaks.length > 0)
  const progress =
    isPlaying && currentDuration > 0
      ? Math.max(0, Math.min(1, currentTime / currentDuration))
      : 0

  const [hoverFrac, setHoverFrac] = useState(-1)
  const [dragging, setDragging] = useState(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawWaveform(canvas, { bars, progress, hover: hoverFrac, isReal, isPlaying })
  }, [bars, progress, hoverFrac, isReal, isPlaying])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw])

  function pointerFraction(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!canPlay) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    const frac = pointerFraction(e)
    setHoverFrac(frac)
    // Live scrub during playback: seek immediately on press too, not just on drag.
    if (isPlaying) audio.seekFraction(frac)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    const frac = pointerFraction(e)
    setHoverFrac(frac)
    if (dragging && isPlaying) audio.seekFraction(frac)
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!canPlay) return
    const wasDragging = dragging
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* release can throw if capture already gone */
    }
    if (!wasDragging) return
    if (!isPlaying) onPlayAt(pointerFraction(e))
  }

  function onPointerLeave(): void {
    if (!dragging) setHoverFrac(-1)
  }

  return (
    <canvas
      ref={canvasRef}
      className={`block h-10 w-full select-none ${canPlay ? 'cursor-pointer' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    />
  )
}
