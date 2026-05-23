/**
 * Filesystem operations the renderer needs via IPC.
 * Kept thin — anything more complex (metadata, tag lookups) lives elsewhere.
 */
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { AudioFile } from '../shared/types'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i).toLowerCase()
}

export async function scanDownloads(
  dir: string,
  scanSubfolders: boolean,
  extensions: string[]
): Promise<AudioFile[]> {
  const exts = new Set(extensions.map((e) => e.toLowerCase()))
  const results: AudioFile[] = []

  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = join(d, ent.name)
      if (ent.isFile()) {
        if (!exts.has(extOf(ent.name))) continue
        try {
          const st = await fsp.stat(full)
          results.push({
            path: full,
            name: ent.name,
            sizeBytes: st.size,
            modifiedMs: st.mtimeMs
          })
        } catch {
          /* skip unreadable files */
        }
      } else if (ent.isDirectory() && scanSubfolders) {
        await walk(full)
      }
    }
  }

  await walk(dir)
  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}

export async function scanLibrary(musicRoot: string, extensions: string[]): Promise<string[]> {
  const exts = new Set(extensions.map((e) => e.toLowerCase()))
  const names: string[] = []

  async function walk(d: string): Promise<void> {
    let entries
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.isFile()) {
        if (exts.has(extOf(ent.name))) names.push(ent.name.toLowerCase())
      } else if (ent.isDirectory()) {
        await walk(join(d, ent.name))
      }
    }
  }

  await walk(musicRoot)
  return names
}

export async function listGenreFolders(musicRoot: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(musicRoot, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  } catch {
    return []
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true })
}

export async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await fsp.rename(src, dest)
  } catch {
    // Cross-volume move — fall back to copy + delete.
    await fsp.copyFile(src, dest)
    await fsp.unlink(src)
  }
}

export async function deleteFile(p: string): Promise<void> {
  await fsp.unlink(p)
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Read a file as raw bytes. Returns the Node Buffer directly — Electron's
 * structured-clone serializer turns it into a Uint8Array on the renderer
 * side. Used by the renderer to feed wavesurfer.js a Blob URL instead of
 * a custom-scheme URL (which fetch() refuses to parse).
 */
export async function readFile(p: string): Promise<Uint8Array> {
  const buf = await fsp.readFile(p)
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}
