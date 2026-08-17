import { AsyncCache } from '../../shared/async-cache.js'
import { getBaiduArtist, getBaiduLyrics, getBaiduPicture, getBaiduTracks, getBaiduUrl, searchBaidu } from './baidu.js'
import { getKugouArtist, getKugouLyrics, getKugouPicture, getKugouTracks, getKugouUrl, searchKugou } from './kugou.js'
import { getKuwoArtist, getKuwoLyrics, getKuwoPicture, getKuwoTracks, getKuwoUrl, searchKuwo } from './kuwo.js'
import { getNeteaseArtistTracks, getNeteaseLyrics, getNeteasePicture, getNeteaseTracks, getNeteaseUrl, searchNetease } from './netease.js'
import { getTencentArtist, getTencentLyrics, getTencentPicture, getTencentTracks, getTencentUrl, searchTencent } from './tencent.js'
import { MUSIC_PLATFORMS, type MusicCollectionOperation, type MusicLyrics, type MusicPlatform, type MusicResourceUrl, type MusicSearchOptions, type MusicTrack } from './types.js'

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SEARCH_CACHE_ENTRIES = 128
const MAX_COLLECTION_TRACKS = 200
const searchCache = new AsyncCache<string, MusicTrack[]>({
  ttlMs: SEARCH_CACHE_TTL_MS,
  maxEntries: MAX_SEARCH_CACHE_ENTRIES
})

interface MusicProvider {
  search(keyword: string, page: number, limit: number, signal?: AbortSignal): Promise<MusicTrack[]>
  tracks(operation: 'song' | 'album' | 'playlist', id: string, signal?: AbortSignal): Promise<MusicTrack[]>
  artist(id: string, limit: number, signal?: AbortSignal): Promise<MusicTrack[]>
  url(id: string, bitrate: number, signal?: AbortSignal): Promise<MusicResourceUrl>
  lyrics(id: string, signal?: AbortSignal): Promise<MusicLyrics>
  picture(id: string, size: number, signal?: AbortSignal): Promise<MusicResourceUrl>
}

const providers: Record<MusicPlatform, MusicProvider> = {
  netease: { search: searchNetease, tracks: getNeteaseTracks, artist: getNeteaseArtistTracks, url: getNeteaseUrl, lyrics: getNeteaseLyrics, picture: (id, size) => Promise.resolve(getNeteasePicture(id, size)) },
  tencent: { search: searchTencent, tracks: getTencentTracks, artist: getTencentArtist, url: getTencentUrl, lyrics: getTencentLyrics, picture: (id, size) => Promise.resolve(getTencentPicture(id, size)) },
  kugou: { search: searchKugou, tracks: getKugouTracks, artist: getKugouArtist, url: getKugouUrl, lyrics: getKugouLyrics, picture: (id, _size, signal) => getKugouPicture(id, signal) },
  baidu: { search: searchBaidu, tracks: getBaiduTracks, artist: getBaiduArtist, url: getBaiduUrl, lyrics: getBaiduLyrics, picture: (id, _size, signal) => getBaiduPicture(id, signal) },
  kuwo: { search: searchKuwo, tracks: getKuwoTracks, artist: getKuwoArtist, url: getKuwoUrl, lyrics: getKuwoLyrics, picture: (id, _size, signal) => getKuwoPicture(id, signal) }
}

export function isMusicPlatform(value: string): value is MusicPlatform {
  return MUSIC_PLATFORMS.some(platform => platform === value)
}

export function searchMusic(options: MusicSearchOptions, signal?: AbortSignal): Promise<MusicTrack[]> {
  const key = `${options.platform}:${options.page}:${options.limit}:${options.keyword}`
  return searchCache.get(
    key,
    async () => structuredClone(await providers[options.platform].search(
      options.keyword,
      options.page,
      options.limit
    )),
    { signal }
  ).then(tracks => structuredClone(tracks))
}

export function clearMusicSearchCache(): void {
  searchCache.clear()
}

export async function getMusicTracks(
  platform: MusicPlatform,
  operation: MusicCollectionOperation,
  id: string,
  limit: number,
  signal?: AbortSignal
): Promise<MusicTrack[]> {
  const tracks = operation === 'artist'
    ? await providers[platform].artist(id, limit, signal)
    : await providers[platform].tracks(operation, id, signal)
  return tracks.slice(0, MAX_COLLECTION_TRACKS)
}

export function getMusicUrl(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicResourceUrl> {
  return providers[platform].url(id, 320, signal)
}

export function getMusicLyrics(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicLyrics> {
  return providers[platform].lyrics(id, signal)
}

export function getMusicPicture(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicResourceUrl> {
  return providers[platform].picture(id, 300, signal)
}
