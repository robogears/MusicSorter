/**
 * Generic modal primitive shared by every dialog (prompt, confirm, settings).
 * Handles the backdrop, the card chrome, ESC-to-close, and click-outside-to-close.
 */
import { useEffect, type ReactNode } from 'react'

interface Props {
  onClose: () => void
  width?: number
  children: ReactNode
}

export function Modal({ onClose, width = 480, children }: Props): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{ width }}
        className="max-w-[95vw] rounded-2xl bg-surface-1 p-7 shadow-2xl ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  )
}
