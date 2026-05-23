/**
 * Always-visible waveform.
 *
 * - If `peaks` is set (decoded by computePeaks during enrichment), bars
 *   reflect the real amplitude envelope of the track.
 * - If not, falls back to deterministic per-filename placeholder bars so
 *   the row still has a waveform-shaped silhouette while decoding catches up.
 * - Hover preview: bars left of the cursor brighten to the "would-seek-here"
 *   color and the bar directly under the cursor highlights white, matching
 *   the Python build's interaction model.
 */
import { useMemo, useState } from 'react'

interface Props {
  seed: string
  bars?: number
  peaks?: number[] | null
  /** Called with the click position as a 0..1 fraction. Pass undefined to make
   *  the wave non-interactive. */
  onClickAt?: (fraction: number) => void
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

export function StaticWave({
  seed,
  bars = 60,
  peaks,
  onClickAt
}: Props): React.JSX.Element {
  const heights = useMemo(() => {
    if (peaks && peaks.length > 0) {
      return peaks.map((p) => Math.max(0.04, p))
    }
    return placeholderHeights(seed, bars)
  }, [seed, bars, peaks])

  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const isReal = !!(peaks && peaks.length > 0)
  const baseColor = isReal ? '#5a5a5a' : '#1a1a1a'

  function pointerFraction(e: React.PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  function updateHoverFromEvent(e: React.PointerEvent<HTMLDivElement>): void {
    const frac = pointerFraction(e)
    const idx = Math.floor(frac * heights.length)
    setHoverIdx(Math.max(0, Math.min(heights.length - 1, idx)))
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!onClickAt) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    updateHoverFromEvent(e)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    updateHoverFromEvent(e)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!onClickAt) return
    const wasDragging = dragging
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* release can throw if capture already gone */
    }
    if (!wasDragging) return
    onClickAt(pointerFraction(e))
  }

  function onPointerLeave(): void {
    if (!dragging) setHoverIdx(null)
  }

  return (
    <div
      className={`relative flex h-10 items-center gap-[2px] select-none ${
        onClickAt ? 'cursor-pointer' : ''
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {heights.map((h, i) => {
        let bg = baseColor
        if (hoverIdx !== null) {
          const d = Math.abs(i - hoverIdx)
          if (d === 0) bg = '#ffffff'
          else if (d === 1) bg = dragging ? '#ffffff' : '#cccccc'
          else if (i < hoverIdx) bg = dragging ? '#aaaaaa' : '#777777'
        }
        return (
          <div
            key={i}
            className="w-[3px] rounded-sm transition-colors duration-75"
            style={{ height: `${h * 100}%`, backgroundColor: bg }}
          />
        )
      })}
      {hoverIdx !== null && (
        <div
          className={`pointer-events-none absolute top-0 bottom-0 w-px ${
            dragging ? 'bg-white' : 'bg-white/60'
          }`}
          style={{ left: `${((hoverIdx + 0.5) / heights.length) * 100}%` }}
        />
      )}
    </div>
  )
}
