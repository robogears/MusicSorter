/**
 * Custom Prompt + Confirm dialogs rendered from the modal slot in the store.
 * Replaces the native window.prompt / window.confirm which look out of place
 * against the rest of the dark UI.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore, type ModalDialog } from '../store'
import { Modal } from './Modal'

export function ModalHost(): React.JSX.Element | null {
  const modal = useStore((s) => s.modal)
  if (!modal) return null
  if (modal.kind === 'prompt') return <PromptDialog modal={modal} />
  return <ConfirmDialog modal={modal} />
}

interface PromptProps {
  modal: Extract<ModalDialog, { kind: 'prompt' }>
}

function PromptDialog({ modal }: PromptProps): React.JSX.Element {
  const [value, setValue] = useState(modal.initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus + select-all on open so the user can just type a replacement.
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
    return () => window.clearTimeout(id)
  }, [])

  function submit(): void {
    const trimmed = value.trim()
    if (!trimmed) return
    modal.onConfirm(trimmed)
  }

  return (
    <Modal onClose={modal.onCancel} width={520}>
      <div className="mb-5 flex items-center">
        <h2 className="text-lg font-bold tracking-tight text-text">{modal.title}</h2>
        <button
          type="button"
          onClick={modal.onCancel}
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-text-muted transition hover:bg-surface-3 hover:text-text"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {modal.label && (
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
          {modal.label}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder={modal.placeholder}
        className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text outline-none focus:border-border-bright"
      />

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={modal.onCancel}
          className="rounded-lg border border-border bg-transparent px-4 py-2 text-xs font-bold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={value.trim().length === 0}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-bold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {modal.confirmText ?? 'OK'}
        </button>
      </div>
    </Modal>
  )
}

interface ConfirmProps {
  modal: Extract<ModalDialog, { kind: 'confirm' }>
}

function ConfirmDialog({ modal }: ConfirmProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const id = window.setTimeout(() => confirmRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <Modal onClose={modal.onCancel} width={480}>
      <div className="mb-5 flex items-center">
        <h2 className="text-lg font-bold tracking-tight text-text">{modal.title}</h2>
        <button
          type="button"
          onClick={modal.onCancel}
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-text-muted transition hover:bg-surface-3 hover:text-text"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <p className="whitespace-pre-line text-sm leading-relaxed text-text-muted">
        {modal.message}
      </p>

      <div className="mt-7 flex justify-end gap-2">
        <button
          type="button"
          onClick={modal.onCancel}
          className="rounded-lg border border-border bg-transparent px-4 py-2 text-xs font-bold text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
        >
          Cancel
        </button>
        <button
          type="button"
          ref={confirmRef}
          onClick={modal.onConfirm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') modal.onConfirm()
          }}
          className={
            modal.destructive
              ? 'rounded-lg border border-danger bg-danger-flash px-5 py-2 text-xs font-bold text-[#ff8a80] transition-colors hover:bg-danger-hover'
              : 'rounded-lg bg-accent px-5 py-2 text-xs font-bold text-accent-fg transition hover:bg-accent-hover'
          }
        >
          {modal.confirmText ?? (modal.destructive ? 'Delete' : 'Confirm')}
        </button>
      </div>
    </Modal>
  )
}
