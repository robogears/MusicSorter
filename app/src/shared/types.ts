/**
 * Shared types used by main, preload, and renderer.
 * Keep this file free of Node- or DOM-only imports so both contexts can pull it in.
 */

export interface AudioFile {
  path: string
  name: string // filename only, with extension
  sizeBytes: number
  modifiedMs: number
}

export interface Config {
  downloadsPath: string
  musicRoot: string
  scanSubfolders: boolean
  audioExtensions: string[]
}

export interface MoveResult {
  ok: boolean
  destPath?: string
  error?: string
}

export interface AudioMetadata {
  artist: string | null
  title: string | null
  durationSeconds: number
  /** Base64-encoded data URL ("data:image/jpeg;base64,…") or null. */
  albumArtDataUrl: string | null
}

export interface GenreTag {
  name: string
  /** Last.fm weight, 0..100. */
  weight: number
}

export interface TagLookupResult {
  tags: GenreTag[]
  /** Human-readable failure reason when tags is empty. */
  error: string | null
}
