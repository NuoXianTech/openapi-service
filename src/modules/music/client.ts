import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import { AsyncCache } from '../../shared/async-cache.js'
import { getBaiduArtist, getBaiduLyrics, getBaiduPicture, getBaiduTracks, getBaiduUrl, searchBaidu } from './baidu.js'
import { getKugouArtist, getKugouLyrics, getKugouPicture, getKugouTracks, getKugouUrl, searchKugou } from './kugou.js'
import { getKuwoArtist, getKuwoLyrics, getKuwoPicture, getKuwoTracks, getKuwoUrl, searchKuwo } from './kuwo.js'
import { getNeteaseArtistTracks, getNeteaseLyrics, getNeteasePicture, getNeteaseTracks, getNeteaseUrl, searchNetease } from './netease.js'
import { getTencentArtist, getTencentLyrics, getTencentPicture, getTencentTracks, getTencentUrl, searchTencent } from './tencent.js'
import { MUSIC_PLATFORMS, type MusicCollectionOperation, type MusicLyrics, type MusicPlatform, type MusicProviderRequestOptions, type MusicResourceUrl, type MusicSearchOptions, type MusicTrack } from './types.js'

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_SEARCH_CACHE_ENTRIES = 128
const MAX_COLLECTION_TRACKS = 200

interface MusicProvider {
  search(keyword: string, page: number, limit: number, options?: MusicProviderRequestOptions): Promise<MusicTrack[]>
  tracks(operation: 'song' | 'album' | 'playlist', id: string, options?: MusicProviderRequestOptions): Promise<MusicTrack[]>
  artist(id: string, limit: number, options?: MusicProviderRequestOptions): Promise<MusicTrack[]>
  url(id: string, bitrate: number, options?: MusicProviderRequestOptions): Promise<MusicResourceUrl>
  lyrics(id: string, options?: MusicProviderRequestOptions): Promise<MusicLyrics>
  picture(id: string, size: number, options?: MusicProviderRequestOptions): Promise<MusicResourceUrl>
}

const providers: Record<MusicPlatform, MusicProvider> = {
  netease: { search: searchNetease, tracks: getNeteaseTracks, artist: getNeteaseArtistTracks, url: getNeteaseUrl, lyrics: getNeteaseLyrics, picture: (id, size) => Promise.resolve(getNeteasePicture(id, size)) },
  tencent: { search: searchTencent, tracks: getTencentTracks, artist: getTencentArtist, url: getTencentUrl, lyrics: getTencentLyrics, picture: (id, size) => Promise.resolve(getTencentPicture(id, size)) },
  kugou: { search: searchKugou, tracks: getKugouTracks, artist: getKugouArtist, url: getKugouUrl, lyrics: getKugouLyrics, picture: (id, _size, options) => getKugouPicture(id, options) },
  baidu: { search: searchBaidu, tracks: getBaiduTracks, artist: getBaiduArtist, url: getBaiduUrl, lyrics: getBaiduLyrics, picture: (id, _size, options) => getBaiduPicture(id, options) },
  kuwo: { search: searchKuwo, tracks: getKuwoTracks, artist: getKuwoArtist, url: getKuwoUrl, lyrics: getKuwoLyrics, picture: (id, _size, options) => getKuwoPicture(id, options) }
}

export function isMusicPlatform(value: string): value is MusicPlatform {
  return MUSIC_PLATFORMS.some(platform => platform === value)
}

export function createMusicClient(configuration: ServiceConfigurationManager) {
  const searchCache = new AsyncCache<string, MusicTrack[]>({
    ttlMs: SEARCH_CACHE_TTL_MS,
    maxEntries: MAX_SEARCH_CACHE_ENTRIES
  })
  const cookie = (platform: MusicPlatform) => (
    configuration.getValue<string>(`music.${platform}Cookie`)
  )
  const requestOptions = (
    platform: MusicPlatform,
    signal?: AbortSignal
  ): MusicProviderRequestOptions => ({
    cookie: cookie(platform),
    ...(signal ? { signal } : {})
  })

  return {
    search(options: MusicSearchOptions, signal?: AbortSignal): Promise<MusicTrack[]> {
      const key = `${options.platform}:${options.page}:${options.limit}:${options.keyword}`
      return searchCache.get(
        key,
        async () => structuredClone(await providers[options.platform].search(
          options.keyword,
          options.page,
          options.limit,
          { cookie: cookie(options.platform) }
        )),
        { signal }
      ).then(tracks => structuredClone(tracks))
    },

    clearSearchCache(): void {
      searchCache.clear()
    },

    async tracks(
      platform: MusicPlatform,
      operation: MusicCollectionOperation,
      id: string,
      limit: number,
      signal?: AbortSignal
    ): Promise<MusicTrack[]> {
      const items = operation === 'artist'
        ? await providers[platform].artist(id, limit, requestOptions(platform, signal))
        : await providers[platform].tracks(operation, id, requestOptions(platform, signal))
      return items.slice(0, MAX_COLLECTION_TRACKS)
    },

    url(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicResourceUrl> {
      return providers[platform].url(id, 320, requestOptions(platform, signal))
    },

    lyrics(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicLyrics> {
      return providers[platform].lyrics(id, requestOptions(platform, signal))
    },

    picture(platform: MusicPlatform, id: string, signal?: AbortSignal): Promise<MusicResourceUrl> {
      return providers[platform].picture(id, 300, requestOptions(platform, signal))
    }
  }
}

export type MusicClient = ReturnType<typeof createMusicClient>
