/**
 * ASCII dancing dude. Cycles through poses on a 120-BPM clock while a track
 * is playing, then scales up with the live amplitude so loud moments make
 * him bounce. Goes idle the instant playback stops.
 */
import { useEffect, useState } from 'react'
import { useStore } from '../store'

const IDLE = '  o  \n /|\\ \n / \\ '
const FRAMES = [
  ' \\o/ \n  |  \n / \\ ',
  '  o  \n_/|\\ \n / \\ ',
  ' \\o/ \n  |  \n / \\ ',
  '  o  \n /|\\_\n / \\ '
]
const BEAT_MS = 500 // 120 BPM

export function Dude(): React.JSX.Element {
  const isPlaying = useStore((s) => s.playingRowId !== null)
  const amp = useStore((s) => s.currentAmp)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!isPlaying) {
      setFrame(0)
      return
    }
    const id = window.setInterval(() => {
      setFrame((i) => (i + 1) % FRAMES.length)
    }, BEAT_MS)
    return () => window.clearInterval(id)
  }, [isPlaying])

  const text = isPlaying && amp > 0.05 ? FRAMES[frame] : IDLE
  const scale = 1 + Math.min(amp, 0.5) * 0.4 // peaks around 1.2x

  return (
    <pre
      style={{
        transform: `scale(${scale})`,
        transition: 'transform 60ms linear',
        transformOrigin: 'bottom center'
      }}
      className="select-none font-mono text-sm leading-tight text-text"
    >
      {text}
    </pre>
  )
}
