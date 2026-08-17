import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import {
  clearGoldPriceCache,
  formatGoldPriceMarkdown,
  getGoldPrice,
  normalizeGoldPriceResponse,
  parseGoldQuoteScript
} from '../src/modules/gold-price/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'gold-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'gold-test',
  serviceName: 'Gold Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function quote(price: number, time: number, extra: Record<string, unknown> = {}) {
  return {
    q63: price, q1: price - 1, q3: price + 2, q4: price - 3,
    digits: 2, unit: '元/克', time, ...extra
  }
}

afterEach(() => {
  clearGoldPriceCache()
  vi.unstubAllGlobals()
})

describe('gold price module', () => {
  it('parses the script and normalizes every quote group', () => {
    const now = Date.parse('2026-08-01T06:00:00Z')
    const payload = parseGoldQuoteScript(`var quote_json = ${JSON.stringify({
      JO_71: quote(881, now), JO_70: quote(1000, now, { digits: 0 }),
      JO_92233: quote(4041.09, now, { unit: '美元/盎司' }),
      JO_42660: quote(1226, now), JO_78648: quote(896.5, now),
      JO_321453: quote(873, now)
    })};`)
    const data = normalizeGoldPriceResponse(payload, now)
    expect(data.date).toBe('2026-08-01')
    expect(data.metals).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '黄金_9999', sell_price: '881' }),
      expect.objectContaining({ name: '伦敦金(现货黄金)', unit: '美元/盎司' })
    ]))
    expect(data.stores[0]).toMatchObject({ brand: '周大福', formatted: '1226元/克' })
    expect(data.banks[0]).toMatchObject({ bank: '建设银行', time: '14:00:00' })
    expect(data.recycle[0]).toMatchObject({ type: '黄金回收', purity: '99.90%' })
  })

  it('caches a successful response and does not expose mutable cache data', async () => {
    const now = Date.now()
    const request = vi.fn().mockResolvedValue(new Response(
      `var quote_json = ${JSON.stringify({ JO_71: quote(881, now) })};`
    ))
    vi.stubGlobal('fetch', request)
    const first = await getGoldPrice()
    first.metals[0]!.name = 'changed'
    const second = await getGoldPrice()
    expect(second.metals[0]!.name).toBe('黄金_9999')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('escapes Markdown table cells and rejects malformed data', () => {
    const now = Date.parse('2026-08-01T06:00:00Z')
    const data = normalizeGoldPriceResponse({
      JO_71: quote(881, now, { unit: '元|克' })
    }, now)
    expect(formatGoldPriceMarkdown(data)).toContain('元\\|克')
    expect(() => parseGoldQuoteScript('{"flag":true}')).toThrow('格式已变化')
    expect(() => normalizeGoldPriceResponse({})).toThrow('未返回可用贵金属行情')
  })

  it('serves standard JSON and raw formats and maps source failures', async () => {
    const now = Date.now()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      `var quote_json = ${JSON.stringify({ JO_71: quote(881, now) })};`
    )))
    const app = createApp({ config, logger })
    const response = await app.request('/v1/gold-price', { headers })
    const body = await response.json() as {
      code: string, data: { metals: unknown[] }, timestamp: number
    }
    expect(response.status).toBe(200)
    expect(body.code).toBe('OK')
    expect(body.data.metals).toHaveLength(1)
    expect(body.timestamp).toEqual(expect.any(Number))
    const markdown = await app.request('/v1/gold-price?encode=markdown', { headers })
    expect(markdown.headers.get('content-type')).toContain('text/markdown')

    clearGoldPriceCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    const failed = await app.request('/v1/gold-price', { headers })
    expect(failed.status).toBe(502)
    expect((await failed.json() as { code: string }).code).toBe('UPSTREAM_ERROR')
  })
})
