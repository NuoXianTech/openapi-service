import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import {
  clearEpicCache,
  formatEpicMarkdown,
  formatEpicText,
  getEpicFreeGames,
  normalizeEpicResponse,
  type EpicFreeGame
} from '../src/modules/epic/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'epic-test-token-that-is-at-least-32-characters'
const authorization = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'epic-test',
  serviceName: 'Epic Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function game(options: {
  id: string
  title: string
  start: string
  end: string
  upcoming?: boolean
  discount?: number
  type?: string
  slug?: string
}) {
  const group = {
    promotionalOffers: [{
      startDate: options.start,
      endDate: options.end,
      discountSetting: { discountPercentage: options.discount ?? 0 }
    }]
  }
  return {
    id: options.id,
    title: options.title,
    offerType: options.type ?? 'BASE_GAME',
    productSlug: options.slug ?? null,
    urlSlug: `fallback-${options.id}`,
    catalogNs: { mappings: [{ pageSlug: `mapping-${options.id}` }] },
    description: `${options.title} 描述`,
    seller: { name: '测试发行商' },
    keyImages: [
      { type: 'Thumbnail', url: 'https://cdn1.epicgames.com/thumb.jpg' },
      { type: 'OfferImageWide', url: `http://cdn1.epicgames.com/${options.id}.jpg` }
    ],
    price: {
      totalPrice: {
        originalPrice: 6200,
        currencyInfo: { decimals: 2 },
        fmtPrice: { originalPrice: '¥62.00' }
      }
    },
    promotions: options.upcoming
      ? { promotionalOffers: [], upcomingPromotionalOffers: [group] }
      : { promotionalOffers: [group], upcomingPromotionalOffers: [] }
  }
}

function payload(games: unknown[]) {
  return { data: { Catalog: { searchStore: { elements: games } } } }
}

afterEach(() => {
  clearEpicCache()
  vi.unstubAllGlobals()
})

describe('epic module', () => {
  it('normalizes current and upcoming games and filters invalid offers', () => {
    const now = Date.parse('2026-08-01T00:00:00Z')
    const games = normalizeEpicResponse(payload([
      game({
        id: 'upcoming', title: 'Mystery Game', upcoming: true,
        start: '2026-08-06T15:00:00Z', end: '2026-08-13T15:00:00Z'
      }),
      game({
        id: 'current', title: '当前游戏', slug: 'current-game/home',
        start: '2026-07-30T15:00:00Z', end: '2026-08-06T15:00:00Z'
      }),
      game({
        id: 'paid', title: '非免费游戏', discount: 50,
        start: '2026-07-30T15:00:00Z', end: '2026-08-06T15:00:00Z'
      }),
      game({
        id: 'dlc', title: 'DLC', type: 'DLC',
        start: '2026-07-30T15:00:00Z', end: '2026-08-06T15:00:00Z'
      })
    ]), now)
    expect(games).toHaveLength(2)
    expect(games[0]).toMatchObject({
      id: 'current',
      is_free_now: true,
      original_price: 62,
      cover: 'https://cdn1.epicgames.com/current.jpg',
      link: 'https://store.epicgames.com/zh-CN/p/current-game/home',
      free_start: '2026-07-30 23:00:00'
    })
    expect(games[1]).toMatchObject({
      id: 'upcoming',
      title: '神秘游戏',
      is_free_now: false
    })
  })

  it('caches successful upstream responses for ten minutes', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(
      payload([game({
        id: 'future', title: '未来游戏', upcoming: true,
        start: '2099-01-01T00:00:00Z', end: '2099-01-08T00:00:00Z'
      })])
    )))
    vi.stubGlobal('fetch', request)
    expect(await getEpicFreeGames()).toHaveLength(1)
    expect(await getEpicFreeGames()).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toContain('/freeGamesPromotions?')
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('escapes untrusted text in Markdown output', () => {
    const item: EpicFreeGame = {
      id: 'test', title: '测试 [游戏]',
      cover: 'https://cdn1.epicgames.com/test.jpg',
      original_price: 62, original_price_desc: '¥62.00',
      description: '> 描述 <script> ![图片](https://example.com/image.png)',
      seller: '发行商 | 测试', is_free_now: true,
      free_start: '2026-07-30 23:00:00',
      free_start_at: Date.parse('2026-07-30T15:00:00Z'),
      free_end: '2026-08-06 23:00:00',
      free_end_at: Date.parse('2026-08-06T15:00:00Z'),
      link: 'https://store.epicgames.com/zh-CN/p/test'
    }
    expect(formatEpicText([item])).toContain('《测试 [游戏]》，现在免费')
    const markdown = formatEpicMarkdown([item])
    expect(markdown).toContain('测试 \\[游戏\\]')
    expect(markdown).toContain('发行商 \\| 测试')
    expect(markdown).not.toContain('![图片]')
  })

  it('serves JSON and raw formats and maps upstream failure to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(
      payload([game({
        id: 'future', title: '未来游戏', upcoming: true,
        start: '2099-01-01T00:00:00Z', end: '2099-01-08T00:00:00Z'
      })])
    ))))
    const app = createApp({ config, logger })
    const response = await app.request('/v1/epic', { headers: authorization })
    const body = await response.json() as {
      code: string, data: EpicFreeGame[], timestamp: number
    }
    expect(response.status).toBe(200)
    expect(body.code).toBe('OK')
    expect(body.data).toHaveLength(1)
    expect(body.timestamp).toEqual(expect.any(Number))

    const text = await app.request('/v1/epic?encode=text', {
      headers: authorization
    })
    expect(await text.text()).toContain('Epic Games 免费游戏')
    const markdown = await app.request('/v1/epic?encoding=md', {
      headers: authorization
    })
    expect(markdown.headers.get('content-type')).toContain('text/markdown')

    clearEpicCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 503 })
    ))
    const failed = await app.request('/v1/epic', { headers: authorization })
    expect(failed.status).toBe(502)
    expect((await failed.json() as { code: string }).code).toBe('UPSTREAM_ERROR')
  })

  it('rejects malformed upstream data', () => {
    expect(() => normalizeEpicResponse({ code: 500 }))
      .toThrow('无效游戏数据')
  })
})
