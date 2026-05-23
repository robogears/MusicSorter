/**
 * Compact volume slider for the header. The audio module subscribes to the
 * store and applies a perceptual (power-3) curve before setting the actual
 * HTMLAudioElement.volume, so dragging from 100% → 0% feels right.
 */
import { useStore } from '../store'

export function VolumeSlider(): React.JSX.Element {
  const volume = useStore((s) => s.volume)
  const setVolume = useStore((s) => s.setVolume)

  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">
        Vol
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        className="vol-slider h-1 w-28 cursor-pointer appearance-none rounded-full bg-surface-3 outline-none"
        aria-label="Volume"
      />
      <span className="w-8 font-mono text-[9px] tabular-nums text-text-muted">
        {Math.round(volume * 100)}%
      </span>
      <style>{`
        .vol-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 9999px;
          background: #ffffff;
          cursor: pointer;
        }
        .vol-slider::-webkit-slider-thumb:hover {
          background: #dddddd;
        }
      `}</style>
    </div>
  )
}
