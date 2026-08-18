import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  clearTodayInHistoryCache,
  formatTodayInHistoryMarkdown,
  formatTodayInHistoryText,
  getTodayInHistory,
  normalizeHistoryMonthResponse,
  parseTodayInHistoryDate,
  type TodayInHistoryData
} from '../src/modules/today-in-history/service.js'
import type { Logger } from '../src/shared/logger.js'

const fetchMocks = vi.hoisted(() => ({ safeFetch: vi.fn() }))
vi.mock('../src/shared/safe-fetch.js', () => ({
  safeFetch: fetchMocks.safeFetch,
  isHostnameWithin: (hostname: string, allowed: string) => (
    hostname === allowed || hostname.endsWith(`.${allowed}`)
  )
}))
vi.mock('../src/shared/limited-response.js', () => ({
  readLimitedText: (response: Response) => response.text()
}))

const token = 'today-history-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'history-test', serviceName: 'History Test',
  version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

afterEach(() => {
  vi.clearAllMocks()
  clearTodayInHistoryCache()
})

function responseFixture() {
  return new Response(JSON.stringify({
    '08': {
      '0801': [{
        year: '2008', title: '测试事件', desc: '测试描述',
        type: 'event', link: 'https://baike.baidu.com/item/test'
      }]
    }
  }))
}

describe('today in history module', () => {
  it('uses the Shanghai day and validates explicit dates', () => {
    expect(parseTodayInHistoryDate('', Date.UTC(2026, 6, 31, 16, 30)))
      .toEqual({ date: '08-01', month: 8, day: 1, dayKey: '0801' })
    expect(parseTodayInHistoryDate('2024-02-29'))
      .toMatchObject({ date: '02-29', month: 2, day: 29 })
    expect(parseTodayInHistoryDate('2023-02-29')).toBeNull()
    expect(parseTodayInHistoryDate('02-30')).toBeNull()
  })

  it('sanitizes, sorts, and deduplicates upstream events', () => {
    const normalized = normalizeHistoryMonthResponse({ '08': { '0801': [
      {
        year: '2001', title: '<a>后发生的事件</a>',
        desc: '描述 &amp; 详情', type: 'unknown',
        link: 'https://example.com/not-allowed'
      },
      {
        year: '-10', title: '<strong>较早人物</strong>出生',
        desc: '公元前人物&#12290;', type: 'birth',
        link: 'http://baike.baidu.com/item/example'
      },
      {
        year: '-10', title: '<strong>较早人物</strong>出生',
        desc: '重复', type: 'birth'
      }
    ] } }, 8)
    expect(normalized['0801']).toEqual([
      {
        title: '较早人物出生', year: '-10', description: '公元前人物。',
        event_type: 'birth', link: 'https://baike.baidu.com/item/example'
      },
      {
        title: '后发生的事件', year: '2001', description: '描述 & 详情',
        event_type: 'event', link: ''
      }
    ])
  })

  it('caches one normalized monthly request', async () => {
    fetchMocks.safeFetch.mockResolvedValueOnce(responseFixture())
    const date = parseTodayInHistoryDate('08-01')!
    const first = await getTodayInHistory(date)
    const second = await getTodayInHistory(date)
    expect(second).toEqual(first)
    expect(first).toMatchObject({ date: '08-01', total: 1 })
    expect(fetchMocks.safeFetch).toHaveBeenCalledTimes(1)
    expect(fetchMocks.safeFetch.mock.calls[0]?.[0])
      .toBe('https://baike.baidu.com/cms/home/eventsOnHistory/08.json')
    expect(fetchMocks.safeFetch.mock.calls[0]?.[1])
      .toMatchObject({ allowedHosts: ['baike.baidu.com'] })
  })

  it('formats text and escaped Markdown', () => {
    const data: TodayInHistoryData = {
      date: '08-01', month: 8, day: 1, total: 1,
      items: [{
        title: '测试 [事件] *强调*', year: '未知_[年份]',
        description: '> 引用 ![图片](https://example.com/a.png)',
        event_type: 'birth', link: 'https://baike.baidu.com/item/test'
      }]
    }
    expect(formatTodayInHistoryText(data)).toContain('出生：测试 [事件]')
    const markdown = formatTodayInHistoryMarkdown(data)
    expect(markdown).toContain('测试 \\[事件\\] \\*强调\\*')
    expect(markdown).not.toContain('![图片]')
  })

  it('serves standard JSON, Markdown, and stable validation errors', async () => {
    const app = createApp({ config, logger })
    fetchMocks.safeFetch.mockResolvedValueOnce(responseFixture())
    const json = await app.request('/v1/today-in-history?date=08-01', {
      headers
    })
    expect(json.status).toBe(200)
    expect(json.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(await json.json()).toMatchObject({
      code: 'OK', data: { date: '08-01', total: 1 }
    })

    const markdown = await app.request(
      '/v1/today-in-history?date=08-01&encode=md', { headers }
    )
    expect(markdown.headers.get('content-type')).toContain('text/markdown')

    const invalid = await app.request(
      '/v1/today-in-history?date=02-30', { headers }
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_DATE' })
  })
})
