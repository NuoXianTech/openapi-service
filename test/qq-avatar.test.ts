import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  createQqAvatarData,
  normalizeQqNumber,
  parseQqAvatarOutputType,
  parseQqAvatarSize
} from '../src/modules/qq-avatar/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'qq-avatar-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'qq-avatar-test', serviceName: 'QQ Avatar Test',
  version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

describe('QQ avatar module', () => {
  it('validates QQ numbers without numeric precision loss', () => {
    expect(normalizeQqNumber(' 10000 ')).toBe('10000')
    expect(normalizeQqNumber('123456789012')).toBe('123456789012')
    expect(normalizeQqNumber('01234')).toBeNull()
    expect(normalizeQqNumber('1234')).toBeNull()
    expect(normalizeQqNumber('1234567890123')).toBeNull()
  })

  it('uses explicit size and output allowlists', () => {
    expect(parseQqAvatarSize('')).toBe(100)
    expect(parseQqAvatarSize('640')).toBe(640)
    expect(parseQqAvatarSize('100.0')).toBeNull()
    expect(parseQqAvatarOutputType('IMAGE')).toBe('image')
    expect(parseQqAvatarOutputType('redirect')).toBeNull()
  })

  it('creates only the canonical Tencent avatar URL', () => {
    expect(createQqAvatarData('10000', 140)).toEqual({
      qq: '10000', size: 140,
      url: 'https://q1.qlogo.cn/g?b=qq&nk=10000&s=140'
    })
  })

  it('returns standard JSON and a fixed-host redirect', async () => {
    const app = createApp({ config, logger })
    const json = await app.request('/v1/qq-avatar?qq=10000&size=140', {
      headers
    })
    expect(json.status).toBe(200)
    expect(json.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(await json.json()).toMatchObject({
      code: 'OK',
      data: {
        qq: '10000', size: 140,
        url: 'https://q1.qlogo.cn/g?b=qq&nk=10000&s=140'
      }
    })
    const image = await app.request(
      '/v1/qq-avatar?qq=10000&type=image',
      { headers, redirect: 'manual' }
    )
    expect(image.status).toBe(302)
    expect(image.headers.get('location'))
      .toBe('https://q1.qlogo.cn/g?b=qq&nk=10000&s=100')
  })

  it('returns stable validation errors', async () => {
    const app = createApp({ config, logger })
    for (const [query, code] of [
      ['', 'MISSING_QQ'],
      ['?qq=1234', 'INVALID_QQ'],
      ['?qq=10000&size=200', 'INVALID_SIZE'],
      ['?qq=10000&type=download', 'INVALID_TYPE']
    ]) {
      const response = await app.request(`/v1/qq-avatar${query}`, { headers })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code, data: null })
    }
  })
})
