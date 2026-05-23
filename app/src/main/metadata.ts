/**
 * Reads audio file tags (artist / title / duration / cover art).
 * Falls back to filename parsing when tags are missing or unhelpful.
 */
import { parseFile } from 'music-metadata'
import type { AudioMetadata } from '../shared/types'

function parseFromFilename(filename: string): { artist: string | null; title: string | null } {
  const dot = filename.lastIndexOf('.')
  let stem = dot === -1 ? filename : filename.slice(0, dot)
  // Drop a leading track number ("01 - ", "12. ", etc).
  stem = stem.replace(/^\s*\d+[\s.\-_]+/, '')
  const sep = stem.indexOf(' - ')
  if (sep !== -1) {
    return {
      artist: stem.slice(0, sep).trim() || null,
      title: stem.slice(sep + 3).trim() || null
    }
  }
  return { artist: null, title: stem.trim() || null }
}

export async function readMetadata(filepath: string): Promise<AudioMetadata> {
  let artist: string | null = null
  let title: string | null = null
  let durationSeconds = 0
  let albumArtDataUrl: string | null = null

  try {
    const md = await parseFile(filepath, { skipCovers: false, duration: true })
    artist = md.common.artist?.trim() || null
    title = md.common.title?.trim() || null
    durationSeconds = md.format.duration ?? 0
    const pic = md.common.picture?.[0]
    if (pic) {
      const mime = pic.format || 'image/jpeg'
      const b64 = Buffer.from(pic.data).toString('base64')
      albumArtDataUrl = `data:${mime};base64,${b64}`
    }
  } catch {
    /* fall through to filename parsing */
  }

  if (!artist || !title) {
    const name = filepath.replace(/\\/g, '/').split('/').pop() || filepath
    const guessed = parseFromFilename(name)
    artist = artist || guessed.artist
    title = title || guessed.title
  }

  return { artist, title, durationSeconds, albumArtDataUrl }
}
