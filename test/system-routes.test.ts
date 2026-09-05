import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { SERVICE_CONTROL_PROTOCOL_V1 } from '../src/contracts/service.js'
import type { Logger } from '../src/shared/logger.js'

const currentToken = 'current-token-that-is-at-least-32-characters'

const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken: currentToken,
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
  version: '0.1.0-test',
  commit: 'test-commit'
}

const silentLogger: Logger = {
  info() {},
  error() {}
}

function createTestApp(overrides: Partial<ServiceConfig> = {}) {
  return createApp({
    config: { ...config, ...overrides },
    logger: silentLogger
  })
}

describe('system routes', () => {
  it('exposes health without a Service Token', async () => {
    const response = await createTestApp().request('/healthz')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('protects the OpenAPI document', async () => {
    const response = await createTestApp().request('/openapi.json')

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Service realm="openapi-service"'
    )
  })

  it('accepts the configured Service Token', async () => {
    const token = currentToken
    const response = await createTestApp().request('/openapi.json', {
      headers: {
        authorization: 'Service ' + token
      }
    })
    const document = (await response.json()) as {
      openapi: string
      paths: Record<
        string,
        {
          get?: {
            'x-openapi-platform'?: { support?: boolean }
            responses?: Record<
              string,
              { headers?: Record<string, unknown> }
            >
          }
        }
      >
    }

    expect(response.status).toBe(200)
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths).toHaveProperty('/healthz')
    expect(document.paths).toHaveProperty('/openapi.json')
    expect(document.paths).toHaveProperty('/v1/60s')
    expect(document.paths).toHaveProperty('/v1/bing')
    expect(document.paths).toHaveProperty('/v1/crypto')
    expect(document.paths).toHaveProperty('/v1/epic')
    expect(document.paths).toHaveProperty('/v1/exchange-rate')
    expect(document.paths).toHaveProperty('/v1/fuel-price')
    expect(document.paths).toHaveProperty('/v1/gold-price')
    expect(document.paths).toHaveProperty('/v1/lanzou')
    expect(document.paths).toHaveProperty('/v1/luck')
    expect(document.paths).toHaveProperty('/v1/minecraft')
    expect(document.paths).toHaveProperty('/v1/music')
    expect(document.paths).toHaveProperty('/v1/password/check')
    expect(document.paths).toHaveProperty('/v1/password')
    expect(document.paths).toHaveProperty('/v1/qq-avatar')
    expect(document.paths).toHaveProperty('/v1/short-video')
    expect(document.paths).toHaveProperty('/v1/today-in-history')
    expect(document.paths['/v1/fuel-price/regions']?.get?.['x-openapi-platform'])
      .toEqual({ support: true })
    expect(
      document.paths['/v1/player/assets/{asset}']?.get?.['x-openapi-platform']
    ).toEqual({ support: true })
    expect(
      document.paths['/v1/player']?.get?.['x-openapi-platform']
    ).toBeUndefined()
    expect(
      document.paths['/openapi.json']?.get?.responses?.['200']
        ?.headers
    ).toHaveProperty('etag')
    expect(
      document.paths['/openapi.json']?.get?.responses?.['304']
        ?.headers
    ).toHaveProperty('x-openapi-sha256')
    expect(response.headers.get('x-openapi-sha256')).toMatch(
      /^[0-9a-f]{64}$/
    )
    expect(response.headers.get('etag')).toBe(
      `"sha256-${response.headers.get('x-openapi-sha256')}"`
    )
  })

  it('accepts the previous Service Token only during a rotation window', async () => {
    const previousServiceToken
      = 'previous-service-token-that-is-at-least-32-characters'
    const response = await createTestApp({ previousServiceToken }).request(
      '/openapi.json',
      { headers: { authorization: `Service ${previousServiceToken}` } }
    )
    const retired = await createTestApp().request('/openapi.json', {
      headers: { authorization: `Service ${previousServiceToken}` }
    })

    expect(response.status).toBe(200)
    expect(retired.status).toBe(401)
  })

  it('exposes the same contract fingerprint in service discovery', async () => {
    const app = createTestApp()
    const headers = {
      authorization: 'Service ' + currentToken
    }
    const openAPIResponse = await app.request('/openapi.json', { headers })
    const descriptionResponse = await app.request(
      '/.well-known/service.json',
      { headers }
    )
    const description = (await descriptionResponse.json()) as {
      openapiSha256: string
      serviceId: string
      serviceProtocol: string
      configuration: { schemaSha256: string }
    }

    expect(descriptionResponse.status).toBe(200)
    expect(description.openapiSha256).toBe(
      openAPIResponse.headers.get('x-openapi-sha256')
    )
    expect(descriptionResponse.headers.get('x-openapi-sha256')).toBe(
      description.openapiSha256
    )
    expect(description.serviceId).toBe(config.serviceId)
    expect(description.serviceProtocol).toBe(SERVICE_CONTROL_PROTOCOL_V1)
    expect(description).not.toHaveProperty('platformProtocol')
    expect(description.configuration.schemaSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the OpenAPI fingerprint stable across Service releases', async () => {
    const headers = { authorization: 'Service ' + currentToken }
    const first = await createTestApp({ version: '0.1.0' })
      .request('/openapi.json', { headers })
    const second = await createTestApp({ version: '0.1.1' })
      .request('/openapi.json', { headers })

    expect(first.headers.get('x-openapi-sha256')).toBe(
      second.headers.get('x-openapi-sha256')
    )
  })

  it('returns 304 when Platform already has the current contract', async () => {
    const app = createTestApp()
    const authorization = 'Service ' + currentToken
    const firstResponse = await app.request('/openapi.json', {
      headers: { authorization }
    })
    const etag = firstResponse.headers.get('etag')

    expect(etag).toBeTruthy()

    const unchangedResponse = await app.request('/openapi.json', {
      headers: {
        authorization,
        'if-none-match': etag ?? ''
      }
    })

    expect(unchangedResponse.status).toBe(304)
    expect(await unchangedResponse.text()).toBe('')
    expect(unchangedResponse.headers.get('etag')).toBe(etag)
  })

  it('preserves a valid inbound request ID', async () => {
    const requestID = randomUUID()
    const response = await createTestApp().request('/healthz', {
      headers: {
        'x-request-id': requestID
      }
    })

    expect(response.headers.get('x-request-id')).toBe(requestID)
  })
})
