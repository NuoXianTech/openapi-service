import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  clearDaily60sCache,
  formatDaily60sMarkdown,
  formatDaily60sText,
  getDaily60s,
  normalizeDaily60sResponse,
  parseDaily60sDate
} from '../src/modules/daily60s/service.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'daily-60s-token-that-is-at-least-32-characters'
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
  serviceId: 'daily-60s-test-service',
  serviceName: 'Daily 60s Test Service',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function payload(date: string) {
  return {
    date,
    news: [
      '第一条新闻',
      { title: '第二条新闻', link: 'https://example.com/ignored' },
      '',
      { title: '' }
    ],
    cover: 'https://mmbiz.qpic.cn/cover.jpg',
    tip: '每日微语',
    image: 'https://example.com/not-exposed.png',
    link: 'https://mp.weixin.qq.com/s/example',
    created: '2026/08/07 07:39',
    created_at: 1786059555983,
    updated: '2026/08/07 07:40',
    updated_at: 1786059600000
  }
}

afterEach(() => {
  clearDaily60sCache()
  vi.unstubAllGlobals()
})

describe('daily 60s module', () => {
  it('uses the Shanghai date and validates explicit calendar dates', () => {
    expect(parseDaily60sDate('', Date.UTC(2026, 7, 6, 16, 30)))
      .toBe('2026-08-07')
    expect(parseDaily60sDate('2024-02-29')).toBe('2024-02-29')
    expect(parseDaily60sDate('2023-02-29')).toBeNull()
    expect(parseDaily60sDate('2026-8-7')).toBeNull()
    expect(parseDaily60sDate('2026/08/07')).toBeNull()
  })

  it('normalizes untrusted source data and formats raw representations', () => {
    const data = normalizeDaily60sResponse({
      ...payload('2026-08-07'),
      news: ['测试 [新闻] *强调*'],
      tip: '> 不可信的 ![图片](https://example.com/image.png)',
      link: 'javascript:alert(1)',
      ignored: 'not exposed'
    }, '2026-08-07', 1786089268780)

    expect(data).toMatchObject({
      date: '2026-08-07',
      cover: 'https://mmbiz.qpic.cn/cover.jpg',
      link: '',
      day_of_week: '星期五',
      lunar_date: '丙午年六月廿五',
      api_updated_at: 1786089268780
    })
    expect(data).not.toHaveProperty('image')
    expect(data).not.toHaveProperty('ignored')
    expect(formatDaily60sText(data)).toContain('1. 测试 [新闻] *强调*')
    const markdown = formatDaily60sMarkdown(data)
    expect(markdown).toContain('1. 测试 \\[新闻\\] \\*强调\\*')
    expect(markdown).not.toContain('![图片](https://example.com/image.png)')
  })

  it('falls back two days for the latest issue and caches successful data', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(
        payload('2026-08-06')
      )))
    vi.stubGlobal('fetch', request)

    const first = await getDaily60s('2026-08-07', { fallback: true })
    const cached = await getDaily60s('2026-08-06')

    expect(first.date).toBe('2026-08-06')
    expect(cached).toBe(first)
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[2]?.[0]).toBe(
      'https://60s-static.viki.moe/60s/2026-08-06.json'
    )
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('serves the standard JSON envelope and raw text through Hono', async () => {
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(payload('2026-08-07')),
      { headers: { 'content-type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', request)
    const app = createApp({ config, logger })

    const response = await app.request('/v1/60s?date=2026-08-07', {
      headers: authorization
    })
    const body = await response.json() as {
      code: string
      message: string
      data: { date: string, news: string[] }
      timestamp: number
    }
    expect(response.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual([
      'code',
      'data',
      'message',
      'timestamp'
    ])
    expect(body).toMatchObject({
      code: 'OK',
      message: '获取每日 60 秒成功',
      data: { date: '2026-08-07', news: ['第一条新闻', '第二条新闻'] }
    })
    expect(Number.isSafeInteger(body.timestamp)).toBe(true)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=900'
    )

    const text = await app.request(
      '/v1/60s?date=2026-08-07&encoding=text',
      { headers: authorization }
    )
    expect(text.status).toBe(200)
    expect(text.headers.get('content-type')).toContain('text/plain')
    expect(await text.text()).toContain('每天 60s 读懂世界')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('returns stable errors for invalid input and malformed source data', async () => {
    const app = createApp({ config, logger })
    const invalidDate = await app.request('/v1/60s?date=2023-02-29', {
      headers: authorization
    })
    const invalidEncoding = await app.request('/v1/60s?encode=html', {
      headers: authorization
    })
    expect(invalidDate.status).toBe(400)
    expect(await invalidDate.json()).toMatchObject({
      code: 'INVALID_DATE',
      data: null
    })
    expect(invalidEncoding.status).toBe(400)
    expect(await invalidEncoding.json()).toMatchObject({
      code: 'INVALID_ENCODING',
      data: null
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ date: '2026-08-07', news: [] })
    )))
    const upstreamError = await app.request(
      '/v1/60s?date=2026-08-07',
      { headers: authorization }
    )
    expect(upstreamError.status).toBe(502)
    expect(await upstreamError.json()).toMatchObject({
      code: 'UPSTREAM_ERROR',
      data: null
    })
    expect(upstreamError.headers.get('x-openapi-error-code')).toBe(
      'UPSTREAM_ERROR'
    )
  })
})
