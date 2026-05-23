/**
 * Promise-based wrappers around the modal slot. Use these from actions /
 * handlers instead of window.prompt / window.confirm.
 */
import { useStore } from './store'

interface PromptOpts {
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
}

interface ConfirmOpts {
  title: string
  message: string
  confirmText?: string
  destructive?: boolean
}

export function showPrompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    useStore.getState().setModal({
      kind: 'prompt',
      title: opts.title,
      label: opts.label,
      placeholder: opts.placeholder,
      initialValue: opts.initialValue ?? '',
      confirmText: opts.confirmText,
      onConfirm: (value) => {
        useStore.getState().setModal(null)
        resolve(value)
      },
      onCancel: () => {
        useStore.getState().setModal(null)
        resolve(null)
      }
    })
  })
}

export function showConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.getState().setModal({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmText: opts.confirmText,
      destructive: opts.destructive,
      onConfirm: () => {
        useStore.getState().setModal(null)
        resolve(true)
      },
      onCancel: () => {
        useStore.getState().setModal(null)
        resolve(false)
      }
    })
  })
}
