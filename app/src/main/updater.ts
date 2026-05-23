/**
 * In-app updater per updater.md.
 *
 * - On launch (packaged builds only), silently polls GitHub's
 *   /releases/latest endpoint. If a newer published release exists, notifies
 *   the renderer with download + release URLs.
 * - Manual check from Settings hits the same `getUpdateStatus()` path.
 * - Download streams the platform-appropriate asset to a temp file with live
 *   progress events.
 * - Self-install:
 *     - macOS: mounts the DMG via `hdiutil`, copies the .app via `ditto`,
 *       then writes a double-fork bash relauncher that waits for the parent
 *       PID to exit, swaps into /Applications/, ad-hoc re-signs, and `open`s
 *       the new app. Survives App Translocation by detecting `/AppTranslocation/`
 *       in the running exe path and installing to /Applications/ instead.
 *     - Windows: NSIS installer can't self-swap; `canSelfInstall()` returns
 *       false and the renderer falls back to opening the release page in
 *       the user's default browser.
 */
import { app, BrowserWindow, shell } from 'electron'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as https from 'node:https'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  UpdateActionResult,
  UpdateDownloadProgress,
  UpdateStatus
} from '../shared/types'

const OWNER = 'robogears'
const REPO = 'MusicSorter'

let mainWindowRef: BrowserWindow | null = null
let pendingUpdatePath: string | null = null

interface GitHubAsset {
  name?: string
  browser_download_url?: string
}

interface GitHubRelease {
  tag_name?: string
  html_url?: string
  assets?: GitHubAsset[]
}

function userAgent(): string {
  return `MusicSorter/${app.getVersion()}`
}

function fetchLatestRelease(): Promise<GitHubRelease | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': userAgent(),
          Accept: 'application/vnd.github+json'
        },
        timeout: 10_000
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null)
          try {
            resolve(JSON.parse(data) as GitHubRelease)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

function isNewerVersion(remote: string, current: string): boolean {
  const r = String(remote)
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const c = String(current)
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const len = Math.max(r.length, c.length)
  for (let i = 0; i < len; i++) {
    const a = r[i] || 0
    const b = c[i] || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const release = await fetchLatestRelease()
  if (!release || !release.tag_name) {
    return { status: 'error', message: 'Could not reach GitHub' }
  }
  if (!isNewerVersion(release.tag_name, app.getVersion())) {
    return { status: 'up-to-date', version: app.getVersion() }
  }
  // Platform asset match. We ship arm64-only DMG on macOS and an NSIS
  // installer on Windows; substring match handles both.
  const wantedSubstr =
    process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '-setup.exe' : null
  let downloadUrl = release.html_url || ''
  if (wantedSubstr) {
    const asset = (release.assets || []).find((a) => a.name && a.name.includes(wantedSubstr))
    if (asset && asset.browser_download_url) downloadUrl = asset.browser_download_url
  }
  // Strip the leading "v" so version is consistently "0.X.Y" everywhere
  // (matches what `app.getVersion()` returns). Display callers prepend "v"
  // themselves — otherwise the GitHub-tag flavor double-prefixes to "vv0.X.Y".
  return {
    status: 'available',
    version: release.tag_name.replace(/^v/, ''),
    downloadUrl,
    releaseUrl: release.html_url || ''
  }
}

/** True when we can swap the installed app in place. macOS DMG only — our
 *  NSIS Windows build relies on the installer flow (canSelfInstall=false →
 *  the renderer opens the release page in the browser). */
export function canSelfInstall(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return true
  return false
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fetch = (u: string, redirects = 0): void => {
      const req = https.request(
        u,
        { method: 'GET', headers: { 'User-Agent': userAgent() } },
        (res) => {
          const status = res.statusCode ?? 0
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            res.headers.location &&
            redirects < 5
          ) {
            res.resume()
            fetch(res.headers.location, redirects + 1)
            return
          }
          if (status !== 200) {
            res.resume()
            reject(new Error(`HTTP ${status} for ${u}`))
            return
          }
          const total = parseInt(res.headers['content-length'] || '0', 10) || 0
          let downloaded = 0
          const out = fs.createWriteStream(destPath)
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length
            onProgress(downloaded, total)
          })
          res.pipe(out)
          out.on('finish', () => out.close(() => resolve()))
          out.on('error', reject)
          res.on('error', reject)
        }
      )
      req.on('error', reject)
      req.setTimeout(60_000, () => {
        req.destroy(new Error('Download timed out'))
      })
      req.end()
    }
    fetch(url)
  })
}

function mountAndExtractMacDmg(dmgPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ts = Date.now()
    const mountPoint = path.join(os.tmpdir(), `app-mount-${ts}`)
    const stagingDir = path.join(os.tmpdir(), `app-update-${ts}`)
    try {
      fs.mkdirSync(stagingDir, { recursive: true })
    } catch {
      /* ignore */
    }

    const detach = (): void => {
      try {
        spawn('hdiutil', ['detach', '-quiet', mountPoint], { stdio: 'ignore' }).unref()
      } catch {
        /* ignore */
      }
    }

    const attach = spawn(
      'hdiutil',
      ['attach', '-nobrowse', '-quiet', '-mountpoint', mountPoint, dmgPath],
      { stdio: 'ignore' }
    )
    attach.on('error', reject)
    attach.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hdiutil attach exit ${code}`))
      let appName: string | undefined
      try {
        appName = fs.readdirSync(mountPoint).find((n) => n.endsWith('.app'))
      } catch (e) {
        detach()
        return reject(new Error(`Read mount: ${(e as Error).message}`))
      }
      if (!appName) {
        detach()
        return reject(new Error('No .app in DMG'))
      }

      const sourceApp = path.join(mountPoint, appName)
      const destApp = path.join(stagingDir, appName)
      const cp = spawn('ditto', [sourceApp, destApp], { stdio: 'ignore' })
      cp.on('error', (err) => {
        detach()
        reject(err)
      })
      cp.on('close', (cpCode) => {
        detach()
        if (cpCode !== 0) return reject(new Error(`ditto exit ${cpCode}`))
        resolve(destApp)
      })
    })
  })
}

export async function downloadUpdate(url: string): Promise<UpdateActionResult> {
  if (!canSelfInstall()) return { ok: false, error: 'Not supported on this platform/build' }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return { ok: false, error: 'Invalid URL' }
  }

  const ext = process.platform === 'darwin' ? '.dmg' : '.exe'
  const destPath = path.join(os.tmpdir(), `app-update-${Date.now()}${ext}`)

  try {
    await downloadToFile(url, destPath, (downloaded, total) => {
      const payload: UpdateDownloadProgress = { downloaded, total }
      mainWindowRef?.webContents.send('update:download-progress', payload)
    })
    pendingUpdatePath =
      process.platform === 'darwin' ? await mountAndExtractMacDmg(destPath) : destPath
    return { ok: true }
  } catch (e) {
    try {
      fs.unlinkSync(destPath)
    } catch {
      /* ignore */
    }
    return { ok: false, error: (e as Error).message }
  }
}

function applyUpdateMac(): boolean {
  if (!pendingUpdatePath) return false

  const runningAppBundle = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '')
  const isTranslocated = runningAppBundle.includes('/AppTranslocation/')
  const targetAppBundle = isTranslocated
    ? path.join('/Applications', app.getName() + '.app')
    : runningAppBundle

  const ts = Date.now()
  const scriptPath = path.join(os.tmpdir(), `app-update-${ts}.sh`)

  // Diagnostic logs survive in ~/Library/Logs/MusicSorter/ — invaluable when
  // a self-install silently fails to even start (the daemonized child might
  // die before any IPC ever fires).
  const logDir = path.join(os.homedir(), 'Library', 'Logs', app.getName())
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const logPath = path.join(logDir, `update-${ts}.log`)
  const attemptLogPath = path.join(logDir, 'attempts.log')
  try {
    fs.appendFileSync(
      attemptLogPath,
      `[${new Date().toISOString()}] applyUpdate\n` +
        `  pid: ${process.pid}\n` +
        `  new: ${pendingUpdatePath}\n` +
        `  target: ${targetAppBundle}\n` +
        `  translocated: ${isTranslocated}\n` +
        `  log: ${logPath}\n`
    )
  } catch {
    /* ignore */
  }

  // Stage 1 re-execs with nohup+disown so the daemon survives app.quit().
  // Stage 2 does the actual swap (parent PID wait, quarantine strip, mv,
  // codesign, open). Rollback if mv fails so the user is never appless.
  const script = [
    '#!/bin/bash',
    `LOG="${logPath}"`,
    'if [ "$1" != "--daemonized" ]; then',
    '    nohup "$0" --daemonized "$@" </dev/null >/dev/null 2>&1 &',
    '    disown',
    '    exit 0',
    'fi',
    'shift',
    'exec >>"$LOG" 2>&1',
    'set -x',
    'echo "=== update script started $(date) ==="',
    'trap "" HUP TERM',
    'PID=$1',
    `NEW_APP="${pendingUpdatePath}"`,
    `TARGET="${targetAppBundle}"`,
    'BACKUP="${TARGET}.bak"',
    'echo "PID=$PID NEW=$NEW_APP TARGET=$TARGET"',
    'for i in $(seq 1 30); do',
    '    if ! ps -p $PID > /dev/null 2>&1; then echo "Parent gone after ${i}s"; break; fi',
    '    sleep 1',
    'done',
    'xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true',
    'if [ -d "$TARGET" ]; then',
    '    rm -rf "$BACKUP" 2>/dev/null',
    '    if ! mv "$TARGET" "$BACKUP"; then',
    '        echo "ERROR: could not back up existing TARGET (permission?). Aborting."',
    '        rm -f "$0"',
    '        exit 1',
    '    fi',
    'fi',
    'if mv "$NEW_APP" "$TARGET"; then',
    '    codesign --force --deep --sign - "$TARGET" 2>&1 || true',
    '    rm -rf "$BACKUP" 2>/dev/null',
    '    open "$TARGET"',
    'else',
    '    echo "ERROR: mv NEW->TARGET failed. Rolling back."',
    '    [ -d "$BACKUP" ] && [ ! -d "$TARGET" ] && mv "$BACKUP" "$TARGET"',
    '    [ -d "$TARGET" ] && open "$TARGET"',
    'fi',
    'echo "=== script finished $(date) ==="',
    'rm -f "$0"',
    ''
  ].join('\n')

  try {
    fs.writeFileSync(scriptPath, script)
    fs.chmodSync(scriptPath, 0o755)
    const child = spawn('/bin/bash', [scriptPath, String(process.pid)], {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', (err) => {
      try {
        fs.appendFileSync(attemptLogPath, `  SPAWN ERROR: ${err.message}\n`)
      } catch {
        /* ignore */
      }
    })
    child.unref()
    // Give nohup time to reparent before we quit.
    setTimeout(() => app.quit(), 500)
    return true
  } catch (err) {
    try {
      fs.appendFileSync(attemptLogPath, `  THROW: ${(err as Error).message}\n`)
    } catch {
      /* ignore */
    }
    return false
  }
}

export function applyUpdate(): UpdateActionResult {
  if (!pendingUpdatePath) return { ok: false, error: 'No pending update' }
  if (process.platform === 'darwin') {
    return applyUpdateMac() ? { ok: true } : { ok: false, error: 'Relauncher failed to spawn' }
  }
  return { ok: false, error: 'Self-install not supported on this platform' }
}

export function openExternal(url: string): void {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    void shell.openExternal(url)
  }
}

/** Launch check — silent on no-update / failure. Skipped in dev so working
 *  on the next version doesn't spam "update available" every reload. */
export function setupUpdater(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
  if (!app.isPackaged) return
  getUpdateStatus()
    .then((result) => {
      if (
        result.status === 'available' &&
        mainWindowRef &&
        !mainWindowRef.isDestroyed()
      ) {
        mainWindowRef.webContents.send('update:available', result)
      }
    })
    .catch(() => {
      /* silent */
    })
}
