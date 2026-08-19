import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import iconv from 'iconv-lite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { ServiceConfigurationManager } from '../src/configuration/manager.js'
import { getBaiduTracks, searchBaidu } from '../src/modules/music/baidu.js'
import { createMusicClient, isMusicPlatform } from '../src/modules/music/client.js'
import { mergeCookieHeader, parseJsonResponseText } from '../src/modules/music/common.js'
import { getKuwoLyrics, getKuwoTracks, getKuwoUrl, searchKuwo } from '../src/modules/music/kuwo.js'
import { getNeteasePicture } from '../src/modules/music/netease.js'
import { formatMusicLyrics, normalizeMusicRedirectUrl, toPublicMusicTracks } from '../src/modules/music/public-contract.js'
import { parseMusicRequestQuery } from '../src/modules/music/request.js'
import { getTencentPicture } from '../src/modules/music/tencent.js'
import { serviceConfigurationDefinition } from '../src/modules/index.js'
import { MUSIC_PLATFORMS } from '../src/modules/music/types.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'music-test-token-that-is-at-least-32-characters'
const authorization = { authorization: `Service ${serviceToken}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken,
  configurationKey: Buffer.alloc(32, 1),
  readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000,
  maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data',
  assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'music-test-service',
  serviceName: 'Music Test Service',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function configuration(initialValues: Record<string, unknown> = {}) {
  return new ServiceConfigurationManager({
    serviceId: config.serviceId,
    definition: serviceConfigurationDefinition,
    initialValues
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('music contract', () => {
  it('recognizes all supported platforms', () => {
    expect(MUSIC_PLATFORMS).toEqual([
      'netease', 'tencent', 'kugou', 'baidu', 'kuwo'
    ])
    MUSIC_PLATFORMS.forEach(platform => expect(isMusicPlatform(platform)).toBe(true))
    expect(isMusicPlatform('unknown')).toBe(false)
  })

  it('keeps numeric id as search unless type=song is explicit', () => {
    expect(parseMusicRequestQuery({ id: '29732992' })).toMatchObject({
      ok: true,
      data: { platform: 'netease', operation: 'search', id: '29732992' }
    })
    expect(parseMusicRequestQuery({ type: 'song', id: '29732992' }))
      .toMatchObject({
        ok: true,
        data: { platform: 'netease', operation: 'song', id: '29732992' }
      })
    expect(parseMusicRequestQuery({ q: 'legacy' }))
      .toMatchObject({ ok: false, code: 'UNSUPPORTED_PARAMETER' })
    expect(parseMusicRequestQuery({ type: 'song', id: '1', page: '2' }))
      .toMatchObject({ ok: false, code: 'UNSUPPORTED_PARAMETER' })
  })

  it('builds callable resource links without leaking provider field names', () => {
    const [track] = toPublicMusicTracks([{
      id: 1,
      name: '晴天',
      artists: ['周杰伦'],
      album: '叶惠美',
      pictureId: 'picture-id',
      audioId: 'audio-id',
      lyricsId: 'lyrics-id',
      platform: 'netease'
    }], new URL('https://api.example.com'))

    expect(track).toEqual({
      id: '1',
      title: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      url: 'https://api.example.com/v1/music?server=netease&type=url&id=audio-id',
      pic: 'https://api.example.com/v1/music?server=netease&type=pic&id=picture-id',
      lrc: 'https://api.example.com/v1/music?server=netease&type=lrc&id=lyrics-id'
    })
    expect(track).not.toHaveProperty('audioId')
  })

  it('merges translated lyrics and normalizes redirect URLs', () => {
    expect(formatMusicLyrics({
      lyric: '[00:01.00]Hello\n[00:02.00]World',
      tlyric: '[00:01.000]你好'
    })).toBe('[00:01.00]Hello (你好)\n[00:02.00]World')
    expect(normalizeMusicRedirectUrl(
      'tencent',
      'http://ws.stream.qqmusic.qq.com/test.mp3'
    )).toBe('https://dl.stream.qqmusic.qq.com/test.mp3')
    expect(normalizeMusicRedirectUrl('netease', 'javascript:alert(1)'))
      .toBeNull()
  })

  it('parses JSONP safely and merges Cookie values', () => {
    expect(parseJsonResponseText('callback({"items":[1,2]}) trailing'))
      .toEqual({ items: [1, 2] })
    expect(() => parseJsonResponseText('upstream unavailable'))
      .toThrow('无效数据')
    expect(mergeCookieHeader(
      'os=android; uin=0',
      'uin=123; token=value=with=equals'
    )).toBe('os=android; uin=123; token=value=with=equals')
  })

  it('generates deterministic provider picture URLs', () => {
    expect(getNeteasePicture('109951170048506929', 300).url)
      .toMatch(/109951170048506929\.jpg\?param=300y300$/)
    expect(getTencentPicture('003v4UL61IYlTY', 500).url)
      .toBe('https://y.gtimg.cn/music/photo_new/T002R500x500M000003v4UL61IYlTY.jpg?max_age=2592000')
  })
})

describe('music provider regressions', () => {
  it('caches successful searches in the client layer', async () => {
    const music = createMusicClient(configuration())
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 0,
        subcode: 0,
        data: { song: { list: [{
          mid: 'song-mid',
          name: '测试歌曲',
          album: { mid: 'album-mid', title: '测试专辑' },
          singer: [{ name: '测试歌手' }]
        }] } }
      }))
    )
    const options = {
      keyword: 'cache-test',
      platform: 'tencent' as const,
      page: 1,
      limit: 3
    }
    expect(await music.search(options)).toEqual(await music.search(options))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('signs Qianqian searches and normalizes the primary artist', async () => {
    createApp({ config, logger })
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        state: true,
        errno: 22000,
        data: { typeTrack: [{
          TSID: 'T10065400429',
          title: '测试歌曲',
          albumTitle: '测试专辑',
          artist: [
            { name: '伴唱', artistType: 2 },
            { name: '主唱', artistType: 38 }
          ]
        }] }
      }))
    )

    await expect(searchBaidu('晴天', 2, 3)).resolves.toEqual([
      expect.objectContaining({ artists: ['主唱'], platform: 'baidu' })
    ])
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    const canonical = 'appid=16073360&pageNo=2&pageSize=3&timestamp=1700000000&type=1&word=晴天'
    expect(url.searchParams.get('sign')).toBe(
      createHash('md5')
        .update(`${canonical}0b50b02fd0d73a9c4c8c3a781c30845f`)
        .digest('hex')
    )
  })

  it('resolves numeric Qianqian album IDs before album tracks', async () => {
    createApp({ config, logger })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: true, errno: 22000, data: [{ psid: 'P10004270661' }]
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: true,
        errno: 22000,
        data: {
          albumAssetCode: 'P10004270661',
          title: '测试专辑',
          artist: [{ name: '专辑歌手', artistType: 38 }],
          trackList: [{ assetId: 'T10065400429', title: '测试歌曲' }]
        }
      })))
    await expect(getBaiduTracks('album', '12345')).resolves.toEqual([
      expect.objectContaining({ id: 'T10065400429', album: '测试专辑' })
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('albumid2psid')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('albumAssetCode=P10004270661')
  })

  it('parses single-quoted Kuwo search data without evaluating it', async () => {
    createApp({ config, logger })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response("{'abslist':[{'MUSICRID':'MUSIC_228908','SONGNAME':'晴天&nbsp;(Live)','ARTIST':'周杰伦&林俊杰','ALBUM':'叶惠美'}]}")
    )
    await expect(searchKuwo('晴天', 2, 3)).resolves.toEqual([
      expect.objectContaining({
        id: '228908',
        name: '晴天 (Live)',
        artists: ['周杰伦', '林俊杰']
      })
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('pn=1')
  })

  it('uses the signed Kuwo mobile playback endpoint', async () => {
    createApp({ config, logger })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 200,
        data: { url: 'http://example.com/kuwo.mp3', bitrate: 320 }
      }))
    )
    await expect(getKuwoUrl('MUSIC_228908', 320)).resolves.toEqual({
      url: 'https://example.com/kuwo.mp3',
      br: 320
    })
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toContain('type=convert_url_with_sign')
  })

  it('keeps Kuwo album parameters ordered', async () => {
    createApp({ config, logger })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        musiclist: [{
          musicrid: 'MUSIC_1', name: '歌曲', artist: '歌手', album: '专辑'
        }]
      }))
    )
    await expect(getKuwoTracks('album', '42')).resolves.toHaveLength(1)
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toContain('?pn=0&rn=200&stype=albuminfo&albumid=42&')
  })

  it('decodes Kuwo compressed word-by-word lyrics', async () => {
    createApp({ config, logger })
    const raw = [
      '[ti:sample]',
      '[00:01.000]<0,300>か<300,300>ぜ',
      '[00:02.000]<0,0>kaze',
      '[00:03.000]<0,0>风'
    ].join('\n')
    const key = Buffer.from('yeelion')
    const encoded = iconv.encode(raw, 'gb18030')
    const encrypted = Buffer.allocUnsafe(encoded.length)
    for (let index = 0; index < encoded.length; index += 1) {
      encrypted[index] = encoded[index]! ^ key[index % key.length]!
    }
    const response = Buffer.concat([
      Buffer.from('tp=content\r\nserver=test\r\n\r\n'),
      deflateSync(Buffer.from(encrypted.toString('base64')))
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(Uint8Array.from(response))
    )
    await expect(getKuwoLyrics('228908')).resolves.toEqual({
      lyric: '[ti:sample]\n[00:01.000]かぜ\n[00:01.000]kaze\n[00:01.000]风',
      tlyric: ''
    })
  })
})

describe('music route', () => {
  it('keeps configuration isolated between app instances', async () => {
    const firstApp = createApp({
      config,
      logger,
      configuration: configuration({
        'music.tencentCookie': 'uin=10001; token=first'
      })
    })
    const secondApp = createApp({
      config,
      logger,
      configuration: configuration({
        'music.tencentCookie': 'uin=20002; token=second'
      })
    })
    const responseBody = JSON.stringify({
      code: 0,
      subcode: 0,
      data: { song: { list: [] } }
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(responseBody))
      .mockResolvedValueOnce(new Response(responseBody))

    await firstApp.request(
      '/v1/music?server=tencent&id=first-query',
      { headers: authorization }
    )
    await secondApp.request(
      '/v1/music?server=tencent&id=second-query',
      { headers: authorization }
    )

    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers)
    expect(firstHeaders.get('cookie')).toContain('uin=10001; token=first')
    expect(secondHeaders.get('cookie')).toContain('uin=20002; token=second')
  })

  it('returns the standard envelope and uses the Platform public origin', async () => {
    const app = createApp({ config, logger })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 0,
        subcode: 0,
        data: { song: { list: [{
          mid: 'song-mid',
          name: '测试歌曲',
          album: { mid: 'album-mid', title: '测试专辑' },
          singer: [{ name: '测试歌手' }]
        }] } }
      }))
    )
    const response = await app.request(
      '/v1/music?server=tencent&id=29732992',
      {
        headers: {
          ...authorization,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.example.com'
        }
      }
    )
    const body = await response.json() as {
      code: string
      data: { type: string, items: Array<{ url: string }> }
      timestamp: number
    }
    expect(response.status).toBe(200)
    expect(body.code).toBe('OK')
    expect(body.data.type).toBe('search')
    expect(body.data.items[0]?.url)
      .toBe('https://api.example.com/v1/music?server=tencent&type=url&id=song-mid')
    expect(body.timestamp).toEqual(expect.any(Number))
  })

  it('rejects platforms disabled by Service configuration', async () => {
    const manager = configuration({
      'music.enabledPlatforms': ['netease']
    })
    const app = createApp({ config, logger, configuration: manager })
    const response = await app.request(
      '/v1/music?server=kuwo&id=test',
      { headers: authorization }
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'MUSIC_SERVER_DISABLED',
      data: null
    })
  })

  it('redirects resources and returns lyrics as plain text', async () => {
    const app = createApp({ config, logger })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: [{ url: 'http://m7c.music.126.net/song.mp3', br: 320000 }]
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        lrc: { lyric: '[00:01.00]Hello' },
        tlyric: { lyric: '[00:01.00]你好' }
      })))

    const resource = await app.request(
      '/v1/music?server=netease&type=url&id=1',
      { headers: authorization, redirect: 'manual' }
    )
    expect(resource.status).toBe(302)
    expect(resource.headers.get('location'))
      .toBe('https://m7.music.126.net/song.mp3')

    const lyrics = await app.request(
      '/v1/music?server=netease&type=lrc&id=1',
      { headers: authorization }
    )
    expect(lyrics.status).toBe(200)
    expect(lyrics.headers.get('content-type')).toContain('text/plain')
    expect(await lyrics.text()).toBe('[00:01.00]Hello (你好)')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('redacts configured music cookies', () => {
    const manager = configuration({
      'music.neteaseCookie': 'MUSIC_U=secret'
    })
    expect(manager.getRedactedState().values['music.neteaseCookie'])
      .toEqual({ configured: true })
    expect(JSON.stringify(manager.getRedactedState())).not.toContain('secret')
  })
})
