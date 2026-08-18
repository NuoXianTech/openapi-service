import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  detectShortVideoPlatform,
  normalizeShortVideoPayload,
  parseShortVideoUrl
} from '../src/modules/short-video/index.js'
import { extractBilibiliId } from '../src/modules/short-video/platforms/bilibili.js'
import {
  extractDouyinDetailFromHtml,
  formatDouyinDetail
} from '../src/modules/short-video/platforms/douyin.js'
import { parseKuaishouPage } from '../src/modules/short-video/platforms/kuaishou.js'
import { extractPipixiaItemId } from '../src/modules/short-video/platforms/pipixia.js'
import { extractToutiaoVideoId } from '../src/modules/short-video/platforms/toutiao.js'
import { extractWeiboVideoId } from '../src/modules/short-video/platforms/weibo.js'
import type { Logger } from '../src/shared/logger.js'

function thrown(run: () => unknown): unknown {
  try { run() } catch (error) { return error }
  throw new Error('expected function to throw')
}

const token = 'short-video-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'short-video-test', serviceName: 'Short Video Test',
  version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

describe('short-video input', () => {
  it('extracts the first URL from a complete share message', () => {
    expect(parseShortVideoUrl(
      '复制此链接打开抖音：https://v.douyin.com/example/。更多内容'
    ).toString()).toBe('https://v.douyin.com/example/')
  })

  it('rejects credentials, ports, and hostname suffix tricks', () => {
    expect(thrown(() => parseShortVideoUrl(
      'https://user:pass@v.douyin.com/example/'
    ))).toMatchObject({ code: 'INVALID_PARAMETER', status: 400 })
    expect(thrown(() => parseShortVideoUrl(
      'https://v.douyin.com:8443/example/'
    ))).toMatchObject({ code: 'INVALID_PARAMETER', status: 400 })
    const unsupported = parseShortVideoUrl('https://douyin.com.evil.test/1')
    expect(thrown(() => detectShortVideoPlatform(unsupported)))
      .toMatchObject({ code: 'UNSUPPORTED_PLATFORM', status: 422 })
  })

  it.each([
    ['douyin', 'https://v.douyin.com/example/'],
    ['kuaishou', 'https://v.kuaishou.com/example'],
    ['xiaohongshu', 'https://xhslink.com/a/example'],
    ['bilibili', 'https://b23.tv/example'],
    ['weibo', 'https://t.cn/example'],
    ['pipixia', 'https://h5.pipix.com/s/example'],
    ['pipigx', 'https://share.ippzone.com/pp/post/example'],
    ['toutiao', 'https://www.ixigua.com/example']
  ] as const)('detects %s links', (platform, input) => {
    expect(detectShortVideoPlatform(parseShortVideoUrl(input))).toBe(platform)
  })
})

describe('short-video platform parsing', () => {
  it('extracts Douyin state from the official share page', () => {
    const detail = {
      aweme_id: '7400000000000000000', desc: '抖音示例',
      author: { unique_id: 'author-id' },
      authorInfo: { nickname: '作者', uid: '100' },
      video: { play_addr: { url_list: ['https://video.example.com/a.mp4'] } }
    }
    const html = `<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify({ app: { videoDetail: detail } }))}</script>`
    expect(extractDouyinDetailFromHtml(html)).toEqual(detail)
    expect(normalizeShortVideoPayload(
      formatDouyinDetail(detail, detail.aweme_id), 'douyin'
    )).toMatchObject({
      platform: 'douyin', author: '作者', uid: 'author-id',
      url: 'https://video.example.com/a.mp4'
    })
  })

  it('parses Kuaishou INIT_STATE locally', () => {
    const state = { 'tusjoh:example': { photo: {
      caption: '快手示例', userName: '作者',
      mainMvUrls: [{ url: 'https://video.example.com/k.mp4' }]
    } } }
    const html = `<script>window.INIT_STATE = ${JSON.stringify(state)};</script>`
    expect(parseKuaishouPage(
      html, new URL('https://www.kuaishou.com/short-video/example')
    )).toMatchObject({
      code: 200,
      data: { title: '快手示例', url: 'https://video.example.com/k.mp4' }
    })
  })

  it('extracts official platform identifiers', () => {
    expect(extractBilibiliId(new URL(
      'https://www.bilibili.com/video/BV1GJ411x7h7'
    ))).toBe('BV1GJ411x7h7')
    expect(extractWeiboVideoId(new URL(
      'https://weibo.com/tv/show/1034:5000000000000000'
    ))).toBe('1034:5000000000000000')
    expect(extractPipixiaItemId(new URL(
      'https://h5.pipix.com/item/123456789'
    ))).toBe('123456789')
    expect(extractToutiaoVideoId(new URL(
      'https://www.toutiao.com/video/7400000000000000000'
    ))).toBe('7400000000000000000')
  })
})

describe('short-video normalization and route', () => {
  it('normalizes and deduplicates image and live-photo collections', () => {
    const result = normalizeShortVideoPayload({
      code: 200,
      data: {
        type: 'live', title: '实况图集',
        images: ['https://image.example.com/1.jpg', 'https://image.example.com/1.jpg'],
        live_photo: [
          { image: 'https://image.example.com/1.jpg', video: 'https://video.example.com/1.mp4' },
          { image: 'https://image.example.com/1.jpg', video: 'https://video.example.com/1.mp4' },
          { image: 'https://image.example.com/2.jpg', video: 'https://video.example.com/2.mp4' }
        ]
      }
    }, 'xiaohongshu')
    expect(result.images).toEqual([
      'https://image.example.com/1.jpg',
      'https://image.example.com/2.jpg'
    ])
    expect(result.livePhotos).toHaveLength(2)
  })

  it('returns standard input errors without making a network request', async () => {
    const app = createApp({ config, logger })
    const missing = await app.request('/v1/short-video', { headers })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toMatchObject({
      code: 'MISSING_PARAMETER', data: null
    })
    const unsupported = await app.request(
      '/v1/short-video?url=https%3A%2F%2Fexample.com%2Fvideo',
      { headers }
    )
    expect(unsupported.status).toBe(422)
    expect(await unsupported.json()).toMatchObject({
      code: 'UNSUPPORTED_PLATFORM', data: null
    })
  })
})
