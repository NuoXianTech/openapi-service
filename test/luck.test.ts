import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { formatLuckMarkdown, getLuck, parseLuckId } from '../src/modules/luck/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'luck-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  configurationKey: Buffer.alloc(32, 1),
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'luck-test',
  serviceName: 'Luck Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

describe('luck module', () => {
  it('strictly parses optional category IDs', () => {
    expect(parseLuckId('')).toBeUndefined()
    expect(parseLuckId(' 0 ')).toBe(0)
    expect(parseLuckId('18')).toBe(18)
    expect(parseLuckId('01')).toBeNull()
    expect(parseLuckId('-1')).toBeNull()
    expect(parseLuckId('1abc')).toBeNull()
  })

  it('selects categories and tips deterministically', () => {
    expect(getLuck(0, () => 0)).toEqual({
      id: 0, category: '人际运', rank: 27,
      tip: '人运旺盛！扩展人脉吧', tip_index: 0
    })
    const values = [0.999999, 0]
    expect(getLuck(undefined, () => values.shift() ?? 0)).toMatchObject({
      id: 18, category: '大凶', rank: -10, tip_index: 0
    })
    expect(getLuck(19)).toBeNull()
  })

  it('escapes Markdown and serves standard Hono responses', async () => {
    expect(formatLuckMarkdown({
      id: 7, category: '大吉', rank: 10,
      tip: '今天运势不错!', tip_index: 2
    })).toContain('今天运势不错\\!')
    const app = createApp({ config, logger })
    const response = await app.request('/v1/luck?id=7', { headers })
    const body = await response.json() as { code: string, data: { id: number } }
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', data: { id: 7 } })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await app.request('/v1/luck?id=01', { headers })).status).toBe(400)
    expect((await app.request('/v1/luck?id=19', { headers })).status).toBe(404)
  })
})
