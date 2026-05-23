/**
 * Header-mounted update pill. Hidden until the main process tells us an
 * update is available (either at launch or from the Settings "Check for
 * updates" button).
 *
 * If the platform can self-install (currently macOS DMG only — Windows NSIS
 * is a fixed installer flow), the button cycles through the state machine
 * from updater.md Component 3: idle → downloading (with %) → ready →
 * restarting. Otherwise it just opens the release page in the browser.
 */
import { useEffect, useState } from 'react'

type Stage = 'hidden' | 'idle' | 'downloading' | 'ready' | 'restarting' | 'failed'

interface Info {
  version: string
  downloadUrl: string
  releaseUrl: string
}

export function UpdateNotice(): React.JSX.Element | null {
  const [stage, setStage] = useState<Stage>('hidden')
  const [info, setInfo] = useState<Info | null>(null)
  const [percent, setPercent] = useState(0)
  const [selfInstall, setSelfInstall] = useState(false)

  useEffect(() => {
    void window.api.canSelfInstall().then(setSelfInstall)
    const offAvailable = window.api.onUpdateAvailable((payload) => {
      setInfo({
        version: payload.version,
        downloadUrl: payload.downloadUrl,
        releaseUrl: payload.releaseUrl
      })
      // Reset to idle on every new payload — covers re-checks after dismiss.
      setStage('idle')
      setPercent(0)
    })
    const offProgress = window.api.onUpdateDownloadProgress(({ downloaded, total }) => {
      if (total > 0) setPercent(Math.floor((downloaded / total) * 100))
    })
    return () => {
      offAvailable()
      offProgress()
    }
  }, [])

  if (stage === 'hidden' || !info) return null

  async function onClick(): Promise<void> {
    if (!info) return
    // Non-self-install fall-through: open the release page in the browser.
    if (!selfInstall) {
      void window.api.openExternal(info.releaseUrl)
      return
    }
    if (stage === 'idle' || stage === 'failed') {
      setStage('downloading')
      setPercent(0)
      const r = await window.api.downloadUpdate(info.downloadUrl)
      setStage(r.ok ? 'ready' : 'failed')
    } else if (stage === 'ready') {
      setStage('restarting')
      void window.api.applyUpdate()
    }
  }

  let label: string
  let ready = false
  if (!selfInstall) {
    label = `↑ Update to v${info.version}`
  } else {
    switch (stage) {
      case 'downloading':
        label = percent > 0 ? `Downloading ${percent}%` : 'Starting…'
        break
      case 'ready':
        label = 'Restart to apply'
        ready = true
        break
      case 'restarting':
        label = 'Restarting…'
        break
      case 'failed':
        label = 'Download failed — retry'
        break
      case 'idle':
      default:
        label = `↑ Update to v${info.version}`
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={stage === 'restarting' || stage === 'downloading'}
      className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        ready
          ? 'bg-accent text-accent-fg hover:bg-accent-hover'
          : 'bg-nogenre-bg text-nogenre-fg hover:brightness-110'
      }`}
      title={`Released as v${info.version}`}
    >
      {label}
    </button>
  )
}
