/**
 * Load and save the per-user config.json. Lives in Electron's userData dir
 * (Windows: %APPDATA%\<AppName>; macOS: ~/Library/Application Support/<AppName>).
 */
import { promises as fsp } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import type { Config } from '../shared/types'

const DEFAULT_EXTS = [
  '.mp3',
  '.flac',
  '.m4a',
  '.wav',
  '.ogg',
  '.opus',
  '.aac',
  '.wma',
  '.mp4'
]

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function defaultConfig(): Config {
  const home = app.getPath('home')
  return {
    downloadsPath: join(home, 'Downloads'),
    musicRoot: join(home, 'Music'),
    scanSubfolders: false,
    audioExtensions: DEFAULT_EXTS.slice()
  }
}

export async function loadConfig(): Promise<Config> {
  const path = configPath()
  try {
    const text = await fsp.readFile(path, 'utf-8')
    const raw = JSON.parse(text)
    return {
      downloadsPath: typeof raw.downloadsPath === 'string' ? raw.downloadsPath : '',
      musicRoot: typeof raw.musicRoot === 'string' ? raw.musicRoot : '',
      scanSubfolders: Boolean(raw.scanSubfolders),
      audioExtensions: Array.isArray(raw.audioExtensions)
        ? raw.audioExtensions.filter((s: unknown): s is string => typeof s === 'string')
        : DEFAULT_EXTS.slice()
    }
  } catch {
    const cfg = defaultConfig()
    try {
      await fsp.mkdir(app.getPath('userData'), { recursive: true })
      await fsp.writeFile(path, JSON.stringify(cfg, null, 2))
    } catch {
      /* best-effort; first save will retry */
    }
    return cfg
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  const path = configPath()
  await fsp.mkdir(app.getPath('userData'), { recursive: true })
  await fsp.writeFile(path, JSON.stringify(cfg, null, 2))
}
