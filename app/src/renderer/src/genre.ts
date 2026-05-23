/**
 * Picks the genre folder that best matches a list of Last.fm tags.
 *
 * Three passes, in order: exact match, substring either-direction match,
 * fuzzy (Levenshtein-ratio) match. Returns the matched folder name and the
 * tag that drove the match — or null + the top tag when nothing matched
 * (so the UI can offer "create new folder").
 */
import type { GenreTag } from '../../shared/types'

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function ratio(a: string, b: string): number {
  const m = Math.max(a.length, b.length)
  if (m === 0) return 1
  return 1 - levenshtein(a, b) / m
}

export interface Suggestion {
  folder: string | null
  topTag: string | null
}

export function suggestFolder(tags: GenreTag[], folders: string[]): Suggestion {
  if (!tags.length) return { folder: null, topTag: null }

  const lower = new Map<string, string>()
  for (const f of folders) lower.set(f.toLowerCase(), f)

  // 1) exact match
  for (const tag of tags) {
    const tl = tag.name.toLowerCase().trim()
    const hit = lower.get(tl)
    if (hit) return { folder: hit, topTag: tag.name }
  }

  // 2) substring match (either direction)
  for (const tag of tags) {
    const tl = tag.name.toLowerCase().trim()
    for (const [fl, fname] of lower) {
      if (fl.includes(tl) || tl.includes(fl)) return { folder: fname, topTag: tag.name }
    }
  }

  // 3) fuzzy on the top tag against folder names
  const top = tags[0].name
  let best: { folder: string; r: number } | null = null
  for (const [fl, fname] of lower) {
    const r = ratio(top.toLowerCase(), fl)
    if (r >= 0.7 && (!best || r > best.r)) best = { folder: fname, r }
  }
  if (best) return { folder: best.folder, topTag: top }

  return { folder: null, topTag: top }
}
