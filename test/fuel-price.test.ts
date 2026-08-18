import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  clearFuelPriceCache,
  findFuelRegion,
  formatFuelPriceMarkdown,
  getFuelPriceData,
  listFuelRegions,
  parseFuelPrices,
  parseFuelTrend
} from '../src/modules/fuel-price/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'fuel-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'fuel-test',
  serviceName: 'Fuel Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const html = `
<div id="youjia"><dl>
  <dt>北京92号汽油</dt><dd>7.21</dd>
  <dt>北京95号汽油</dt><dd>7.68</dd>
  <dt>北京0号柴油</dt><dd>6.93</dd>
</dl></div>
<div id="youjiaCont"><div style="border:1px solid #EA5146">
下次油价7月15日24时调整，预计上调110元/吨(0.08元/升-0.10元/升)
</div></div>`
afterEach(() => {
  clearFuelPriceCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fuel price module', () => {
  it('retains the complete region catalog and matches suffixes', () => {
    expect(listFuelRegions().length).toBeGreaterThan(2000)
    expect(findFuelRegion('北京')?.region).toBe('北京')
    expect(findFuelRegion('杭州')?.region).toBe('浙江杭州')
    expect(findFuelRegion('西湖')).not.toBeNull()
    expect(findFuelRegion('浙江杭州西湖')?.region).toBe('浙江杭州西湖')
    expect(findFuelRegion('不存在')).toBeNull()
  })

  it('parses prices and adjustment trends', () => {
    expect(parseFuelPrices(html)).toEqual([
      { name: '92号汽油', price: 7.21, price_desc: '7.21 元/升' },
      { name: '95号汽油', price: 7.68, price_desc: '7.68 元/升' },
      { name: '0号柴油', price: 6.93, price_desc: '6.93 元/升' }
    ])
    expect(parseFuelTrend(html)).toMatchObject({
      next_adjustment_date: '7月15日24时', direction: '上调',
      change_ton: 110, change_liter_min: 0.08, change_liter_max: 0.1
    })
  })

  it('caches by region and supports an explicit refresh', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(html))
    vi.stubGlobal('fetch', request)
    const region = findFuelRegion('北京')!
    const first = await getFuelPriceData(region)
    const cached = await getFuelPriceData(region)
    await getFuelPriceData(region, true)
    expect(first.items).toHaveLength(3)
    expect(cached.updated_at).toBe(first.updated_at)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'User-Agent': expect.any(String) }
    })
    expect(formatFuelPriceMarkdown(first)).toContain('- **92号汽油**')
  })

  it('serves price and region responses through Hono', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html)))
    const app = createApp({ config, logger })
    const response = await app.request('/v1/fuel-price?region=北京', { headers })
    const body = await response.json() as {
      code: string, data: { region: string }, timestamp: number
    }
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', data: { region: '北京' } })
    expect(body.timestamp).toEqual(expect.any(Number))

    const regions = await app.request('/v1/fuel-price/regions?keyword=浙江杭州', { headers })
    const regionBody = await regions.json() as { data: { total: number } }
    expect(regionBody.data.total).toBeGreaterThan(10)
    const invalid = await app.request('/v1/fuel-price?region=不存在', { headers })
    expect(invalid.status).toBe(400)
  })

  it('maps an invalid upstream page to a standard 502 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>')))
    const app = createApp({ config, logger })
    const response = await app.request('/v1/fuel-price', { headers })
    const body = await response.json() as { code: string, data: null }
    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'UPSTREAM_ERROR', data: null })
  })
})
