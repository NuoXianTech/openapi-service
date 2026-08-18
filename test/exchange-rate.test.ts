import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  clearExchangeRateCache,
  formatExchangeRateMarkdown,
  formatExchangeRateText,
  getExchangeRates,
  normalizeCurrencyCode,
  normalizeExchangeRateResponse
} from '../src/modules/exchange-rate/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'exchange-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'exchange-test',
  serviceName: 'Exchange Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const upstream = {
  result: 'success', base_code: 'CNY',
  time_last_update_unix: 1783987200,
  time_next_update_unix: 1784073600,
  rates: { CNY: 1, USD: 0.1395, invalid: 'bad' }
}

afterEach(() => {
  clearExchangeRateCache()
  vi.unstubAllGlobals()
})

describe('exchange rate module', () => {
  it('validates currency codes and normalizes upstream data', () => {
    expect(normalizeCurrencyCode(' usd ')).toBe('USD')
    expect(normalizeCurrencyCode('US')).toBeNull()
    const data = normalizeExchangeRateResponse(upstream)
    expect(data).toMatchObject({ base_code: 'CNY', updated_at: 1783987200000 })
    expect(data.rates).toEqual([
      { currency: 'CNY', rate: 1 },
      { currency: 'USD', rate: 0.1395 }
    ])
  })

  it('formats text and Markdown', () => {
    const data = normalizeExchangeRateResponse(upstream)
    expect(formatExchangeRateText(data)).toContain('CNY => 1\nUSD => 0.1395')
    expect(formatExchangeRateMarkdown(data)).toContain('| **USD** | 0.1395 |')
  })

  it('caches each currency independently', async () => {
    const request = vi.fn().mockImplementation(async () => (
      new Response(JSON.stringify(upstream))
    ))
    vi.stubGlobal('fetch', request)
    await getExchangeRates('CNY')
    await getExchangeRates('CNY')
    await getExchangeRates('USD')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('serves standard and raw responses with explicit errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstream))
    ))
    const app = createApp({ config, logger })
    const response = await app.request('/v1/exchange-rate?currency=cny', { headers })
    const body = await response.json() as { code: string, data: { base_code: string }, timestamp: number }
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', data: { base_code: 'CNY' } })
    expect(body.timestamp).toEqual(expect.any(Number))
    const markdown = await app.request('/v1/exchange-rate?encode=markdown', { headers })
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    const invalid = await app.request('/v1/exchange-rate?currency=12', { headers })
    expect(invalid.status).toBe(400)

    clearExchangeRateCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    const failed = await app.request('/v1/exchange-rate', { headers })
    expect(failed.status).toBe(502)
  })
})
