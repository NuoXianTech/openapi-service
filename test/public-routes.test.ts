import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'public-routes-token-at-least-32-characters'
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
  serviceId: 'openapi-service-test',
  serviceName: 'OpenAPI Service Test',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const authorization = { authorization: `Service ${serviceToken}` }

function app() {
  return createApp({ config, logger })
}

describe('migrated public routes', () => {
  it('serves deterministic yiyan records and raw representations', async () => {
    const jsonResponse = await app().request('/v1/yiyan?type=a&id=a1', {
      headers: authorization
    })
    const json = await jsonResponse.json() as {
      code: string
      message: string
      data: { id: string, yiyan: string }
      timestamp: number
    }

    expect(jsonResponse.status).toBe(200)
    expect(Object.keys(json).sort()).toEqual(['code', 'data', 'message', 'timestamp'])
    expect(json.code).toBe('OK')
    expect(json.message).toBe('请求成功')
    expect(json.data.id).toBe('a1')
    expect(json.data.yiyan).toBeTruthy()
    expect(Number.isSafeInteger(json.timestamp)).toBe(true)
    expect(json.timestamp).toBeGreaterThan(0)
    expect(jsonResponse.headers.get('cache-control')).toBe('no-store')

    const textResponse = await app().request(
      '/v1/yiyan?type=a&id=a1&encode=text&charset=gbk',
      { headers: authorization }
    )
    const encoded = Buffer.from(await textResponse.arrayBuffer())

    expect(textResponse.status).toBe(200)
    expect(textResponse.headers.get('content-type')).toContain('charset=gbk')
    expect(iconv.decode(encoded, 'gbk')).toBe(json.data.yiyan)
  })

  it('rejects unsafe JSONP callbacks', async () => {
    const response = await app().request(
      '/v1/yiyan?callback=alert(1)',
      { headers: authorization }
    )
    const body = await response.json() as {
      code: string
      message: string
      data: unknown
      timestamp: number
    }

    expect(response.status).toBe(400)
    expect(Object.keys(body).sort()).toEqual(['code', 'data', 'message', 'timestamp'])
    expect(body.code).toBe('INVALID_PARAMETER')
    expect(body.data).toBeNull()
    expect(Number.isSafeInteger(body.timestamp)).toBe(true)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-openapi-error-code')).toBe('INVALID_PARAMETER')
  })

  it('renders player HTML with pinned same-origin assets and escaped input', async () => {
    const videoURL = encodeURIComponent('https://cdn.example.com/video.m3u8?x=</script>')
    const response = await app().request(`/v1/player?url=${videoURL}&type=hls`, {
      headers: authorization
    })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('/v1/player/assets/hls-1.6.0.min.js')
    expect(html).toContain('\\u003C/script\\u003E')
    expect(html).not.toContain('?x=</script>')
  })

  it('serves pinned player dependencies from the Service package set', async () => {
    const response = await app().request(
      '/v1/player/assets/artplayer-5.3.0.js',
      { headers: authorization }
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(body.slice(0, 200)).toContain('artplayer.js v5.3.0')
  })

  it('serves the bundled nuoxi4n DPlayer build instead of the npm package', async () => {
    const response = await app().request(
      '/v1/player/assets/dplayer-1.27.2-nuoxi4n.min.js',
      { headers: authorization }
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(body).toContain('nuoxi4n/DPlayer')
    expect(body).toContain('1.27.2')
  })

  it('uses the trusted forwarded client IP and reports missing CZDB configuration', async () => {
    const response = await app().request('/v1/ip', {
      headers: {
        ...authorization,
        'x-forwarded-for': '8.8.8.8'
      }
    })
    const body = await response.json() as { code: string }

    expect(response.status).toBe(503)
    expect(body.code).toBe('IP_DATABASE_NOT_CONFIGURED')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-openapi-error-code')).toBe(
      'IP_DATABASE_NOT_CONFIGURED'
    )
  })

  it('rejects invalid IP input before database access', async () => {
    const response = await app().request('/v1/ip?ip=not-an-ip', {
      headers: authorization
    })
    const body = await response.json() as { code: string }

    expect(response.status).toBe(400)
    expect(body.code).toBe('INVALID_IP')
    expect(response.headers.get('x-openapi-error-code')).toBe('INVALID_IP')
  })
})
