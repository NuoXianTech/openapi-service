import { createHash } from 'node:crypto'
import { buildUrl, isRecord, normalizeCollection, readNumber, readPath, readString, requestJson, requestText } from './common.js'
import type { MusicLyrics, MusicProviderRequestOptions, MusicResourceUrl, MusicTrack } from './types.js'

// `baidu` is kept as the public server code for backward compatibility. The
// original Taihe/Baidu Ting API is gone; current Qianqian endpoints live here.
const API_URL = 'https://music.91q.com/v1'
const APP_ID = '16073360'
const SIGNING_SECRET = '0b50b02fd0d73a9c4c8c3a781c30845f'
const BASE_HEADERS = {
  'accept': '*/*',
  'referer': 'https://music.91q.com/player',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143 Safari/537.36'
}

interface QianqianTrackDefaults {
  album?: string
  artists?: string[]
}

function createHeaders(cookie = ''): Record<string, string> {
  return cookie ? { ...BASE_HEADERS, cookie } : BASE_HEADERS
}

function createSignedUrl(path: string, params: Record<string, string | number>): string {
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    appid: APP_ID,
    timestamp: String(Math.floor(Date.now() / 1000))
  }
  const canonical = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join('&')
  values.sign = createHash('md5').update(`${canonical}${SIGNING_SECRET}`).digest('hex')
  return buildUrl(`${API_URL}/${path.replace(/^\//, '')}`, values)
}

async function requestQianqian(
  path: string,
  params: Record<string, string | number>,
  signal?: AbortSignal,
  allowEmpty = false,
  cookie = ''
): Promise<unknown> {
  const payload = await requestJson(createSignedUrl(path, params), { headers: createHeaders(cookie), signal })
  if (!isRecord(payload)) throw new Error('千千音乐上游返回了无效数据')

  const errno = readNumber(payload.errno)
  const failed = (payload.state === false && errno !== 22000) || (errno !== 0 && errno !== 22000)
  if (failed && !(allowEmpty && errno === 23001)) {
    const message = readString(payload.errmsg).trim()
    throw new Error(`千千音乐上游返回业务错误（errno=${errno}${message ? `, ${message}` : ''}）`)
  }
  return payload
}

function readQianqianArtists(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const artists = value.filter(isRecord)
  const primary = artists.filter(item => readNumber(item.artistType, -1) === 38)
  const selected = primary.length > 0 ? primary : artists
  return [...new Set(selected.map(item => readString(item.name).trim()).filter(Boolean))]
}

function normalizeQianqian(value: unknown, defaults: QianqianTrackDefaults = {}): MusicTrack | null {
  if (!isRecord(value)) return null
  const id = readString(value.TSID || value.assetId || value.assetID || value.id).trim()
  const name = readString(value.title || value.name).trim()
  if (!id || !name) return null
  const artists = readQianqianArtists(value.artist)
  return {
    id,
    name,
    artists: artists.length > 0 ? artists : defaults.artists || [],
    album: readString(value.albumTitle, defaults.album || '').trim(),
    pictureId: id,
    audioId: id,
    lyricsId: id,
    platform: 'baidu'
  }
}

function normalizeQianqianTracks(payload: unknown, path: string, defaults: QianqianTrackDefaults = {}): MusicTrack[] {
  return normalizeCollection(payload, path, value => normalizeQianqian(value, defaults))
}

async function resolveAlbumAssetCode(id: string, signal?: AbortSignal, cookie = ''): Promise<string> {
  const value = id.trim()
  if (/^P[A-Za-z0-9]+$/i.test(value)) return `P${value.slice(1)}`

  const payload = await requestQianqian('album/albumid2psid', { albumid: value }, signal, true, cookie)
  const values = readPath(payload, 'data')
  if (!Array.isArray(values)) return ''
  for (const item of values) {
    if (!isRecord(item)) continue
    const psid = readString(item.psid || item.PSID).trim()
    if (/^P[A-Za-z0-9]+$/i.test(psid)) return `P${psid.slice(1)}`
  }
  return ''
}

export async function searchBaidu(keyword: string, page: number, limit: number, options: MusicProviderRequestOptions = {}): Promise<MusicTrack[]> {
  const { signal, cookie = '' } = options
  const payload = await requestQianqian('search', {
    word: keyword,
    type: 1,
    pageNo: page,
    pageSize: limit
  }, signal, true, cookie)
  return normalizeQianqianTracks(payload, 'data.typeTrack')
}

export async function getBaiduTracks(operation: 'song' | 'album' | 'playlist', id: string, options: MusicProviderRequestOptions = {}): Promise<MusicTrack[]> {
  const { signal, cookie = '' } = options
  if (operation === 'song') {
    const payload = await requestQianqian('song/info', { TSID: id }, signal, true, cookie)
    return normalizeQianqianTracks(payload, 'data')
  }

  if (operation === 'album') {
    const albumAssetCode = await resolveAlbumAssetCode(id, signal, cookie)
    if (!albumAssetCode) return []
    const payload = await requestQianqian('album/info', { albumAssetCode }, signal, true, cookie)
    const album = readPath(payload, 'data')
    if (!isRecord(album)) return []
    return normalizeQianqianTracks(album, 'trackList', {
      album: readString(album.title),
      artists: readQianqianArtists(album.artist)
    })
  }

  const payload = await requestQianqian('tracklist/info', { id, type: 0 }, signal, true, cookie)
  return normalizeQianqianTracks(payload, 'data.trackList')
}

export async function getBaiduArtist(_id: string, _limit: number, _options?: MusicProviderRequestOptions): Promise<MusicTrack[]> {
  // The current Qianqian API exposed by music.91q.com has no matching
  // artist-song endpoint. Keep the common contract stable and report no data.
  return []
}

function qianqianQualityRates(bitrate: number): string[] {
  if (bitrate >= 3000) return ['3000', '320', '128', '64']
  if (bitrate >= 320) return ['320', '128', '64']
  if (bitrate >= 128) return ['128', '64']
  return ['64']
}

export async function getBaiduUrl(id: string, bitrate: number, options: MusicProviderRequestOptions = {}): Promise<MusicResourceUrl> {
  const { signal, cookie = '' } = options
  for (const rate of qianqianQualityRates(bitrate)) {
    try {
      const payload = await requestQianqian('song/tracklink', { TSID: id, rate }, signal, true, cookie)
      const data = readPath(payload, 'data')
      if (!isRecord(data)) continue
      const trial = readPath(data, 'trail_audio_info.path')
      const url = readString(data.path || trial).trim().replace(/^http:/, 'https:')
      if (!url) continue
      return {
        url,
        size: readNumber(data.size),
        br: readNumber(data.rate, Number(rate))
      }
    } catch (error) {
      if (signal?.aborted) throw error
      // A quality can be unavailable independently; continue with the next one.
    }
  }
  return { url: '', size: 0, br: -1 }
}

async function getQianqianSongInfo(id: string, signal?: AbortSignal, cookie = ''): Promise<Record<string, unknown> | null> {
  const payload = await requestQianqian('song/info', { TSID: id }, signal, true, cookie)
  const first = readPath(payload, 'data.0')
  return isRecord(first) ? first : null
}

function isTrustedQianqianResource(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === 'music.91q.com'
      || url.hostname.endsWith('.91q.com')
      || url.hostname.endsWith('.taihe.com')
      || url.hostname.endsWith('.dmhmusic.com')
  } catch {
    return false
  }
}

export async function getBaiduLyrics(id: string, options: MusicProviderRequestOptions = {}): Promise<MusicLyrics> {
  const { signal, cookie = '' } = options
  const info = await getQianqianSongInfo(id, signal, cookie)
  const lyricUrl = readString(info?.lyric).trim()
  if (!lyricUrl || !isTrustedQianqianResource(lyricUrl)) return { lyric: '', tlyric: '' }
  const lyric = await requestText(lyricUrl, { headers: createHeaders(cookie), signal })
  return { lyric, tlyric: '' }
}

export async function getBaiduPicture(id: string, options: MusicProviderRequestOptions = {}): Promise<MusicResourceUrl> {
  const { signal, cookie = '' } = options
  const info = await getQianqianSongInfo(id, signal, cookie)
  return { url: readString(info?.pic).trim().replace(/^http:/, 'https:') }
}
