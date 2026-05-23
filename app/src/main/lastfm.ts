/**
 * Last.fm tag lookups.
 *
 * - Tries track.getTopTags first with the original title.
 * - If that returns nothing, retries with a cleaned title — stripping
 *   "(feat. X)", "[Remix]", "(Sped Up)" etc. — which is how a lot of
 *   downloaded files are named.
 * - Falls back to artist.getTopTags so we always have *some* signal.
 *
 * The API key is baked in. Users who hit the shared rate limit can swap
 * it out later (we kept the door open in shared types).
 */
import type { GenreTag, TagLookupResult } from '../shared/types'

const DEFAULT_LASTFM_API_KEY = '25da7294f1c679210c7e12bfda4b2f2e'
const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/'
const USER_AGENT = 'MusicSorter/0.2 (personal use)'

const TITLE_PARENS_RE = /\s*[([][^)\]]*[)\]]/g
const TITLE_FEAT_RE = /\s*(feat\.?|ft\.?|featuring)\s+.+$/i

function cleanTitle(t: string): string {
  return t.replace(TITLE_PARENS_RE, '').replace(TITLE_FEAT_RE, '').trim()
}

interface LastFmEnvelope {
  toptags?: {
    tag?: Array<{ name?: string; count?: number }> | { name?: string; count?: number }
  }
  error?: number
  message?: string
}

interface FetchResult {
  data: LastFmEnvelope | null
  error: string | null
}

async function lastfmGet(method: string, params: Record<string, string>): Promise<FetchResult> {
  const qs = new URLSearchParams({
    ...params,
    method,
    api_key: DEFAULT_LASTFM_API_KEY,
    format: 'json'
  })
  try {
    const resp = await fetch(`${LASTFM_BASE}?${qs.toString()}`, {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!resp.ok) return { data: null, error: `HTTP ${resp.status}` }
    const data = (await resp.json()) as LastFmEnvelope
    if (data?.error) {
      return { data: null, error: data.message || `Last.fm error ${data.error}` }
    }
    return { data, error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message }
  }
}

function parseTags(envelope: LastFmEnvelope | null): GenreTag[] {
  if (!envelope?.toptags?.tag) return []
  const raw = envelope.toptags.tag
  const list = Array.isArray(raw) ? raw : [raw]
  const out: GenreTag[] = []
  for (const t of list) {
    const name = t.name?.trim()
    if (!name) continue
    const weight = Number(t.count ?? 0) || 0
    out.push({ name, weight })
  }
  out.sort((a, b) => b.weight - a.weight)
  return out
}

export async function getTags(artist: string, title: string): Promise<TagLookupResult> {
  let lastErr: string | null = null

  if (artist && title) {
    const trackRes = await lastfmGet('track.getTopTags', {
      artist,
      track: title,
      autocorrect: '1'
    })
    const trackTags = parseTags(trackRes.data)
    if (trackTags.length) return { tags: trackTags, error: null }
    if (trackRes.error) lastErr = trackRes.error

    // Title-clean retry — strips "(feat. X)" etc.
    const cleaned = cleanTitle(title)
    if (cleaned && cleaned.toLowerCase() !== title.toLowerCase()) {
      const retry = await lastfmGet('track.getTopTags', {
        artist,
        track: cleaned,
        autocorrect: '1'
      })
      const retryTags = parseTags(retry.data)
      if (retryTags.length) return { tags: retryTags, error: null }
      if (retry.error) lastErr = retry.error
    }
  }

  if (artist) {
    const artistRes = await lastfmGet('artist.getTopTags', {
      artist,
      autocorrect: '1'
    })
    const artistTags = parseTags(artistRes.data)
    if (artistTags.length) return { tags: artistTags, error: null }
    if (artistRes.error) lastErr = artistRes.error
  }

  return { tags: [], error: lastErr }
}
