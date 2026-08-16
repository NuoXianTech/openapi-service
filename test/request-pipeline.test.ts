import { createRoute, z } from '@hono/zod-openapi'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import type { Logger } from '../src/shared/logger.js'
import { RuntimeState } from '../src/runtime/state.js'

const serviceToken = 'pipeline-token-that-is-at-least-32-characters'

const silentLogger: Logger = {
  info() {},
  error() {}
}

function createConfig(
  overrides: Partial<ServiceConfig> = {}
): ServiceConfig {
  return {
    hostname: '127.0.0.1',
    port: 8080,
    serviceToken,
    readHeaderTimeoutMs: 5_000,
    requestTimeoutMs: 20_000,
    shutdownTimeoutMs: 10_000,
    maxRequestBodyBytes: 1024,
    ipDatabaseDirectory: 'data/ip',
    configurationFile: 'data/runtime/test.enc',
    serviceId: 'openapi-service-test',
    serviceName: 'OpenAPI Service Test',
    version: 'test',
    commit: 'test',
    ...overrides
  }
}

const authorization = {
  authorization: 'Service ' + serviceToken
}

describe('request pipeline', () => {
  it('returns 503 while the runtime is not ready', async () => {
    const runtimeState = new RuntimeState(false, 'maintenance')
    const app = createApp({
      config: createConfig(),
      logger: silentLogger,
      runtimeState
    })

    const unavailable = await app.request('/readyz')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({
      status: 'not_ready',
      reason: 'maintenance'
    })

    runtimeState.markReady()
    const ready = await app.request('/readyz')
    expect(ready.status).toBe(200)
  })

  it('rejects a request body above the configured limit', async () => {
    const app = createApp({
      config: createConfig({ maxRequestBodyBytes: 4 }),
      logger: silentLogger
    })
    app.post('/test/body', async (c) => {
      return c.text(await c.req.text())
    })

    const response = await app.request('/test/body', {
      method: 'POST',
      headers: {
        ...authorization,
        'content-type': 'text/plain'
      },
      body: '12345'
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'REQUEST_BODY_TOO_LARGE'
    })
  })

  it('aborts work and returns 504 when the request deadline expires', async () => {
    const app = createApp({
      config: createConfig({ requestTimeoutMs: 10 }),
      logger: silentLogger
    })
    app.get('/test/deadline', async (c) => {
      const signal = c.get('deadlineSignal')
      await new Promise<void>((_, reject) => {
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener(
          'abort',
          () => reject(signal.reason),
          { once: true }
        )
      })
      return c.text('unexpected')
    })

    const response = await app.request('/test/deadline', {
      headers: authorization
    })

    expect(response.status).toBe(504)
    expect(await response.json()).toMatchObject({
      code: 'REQUEST_TIMEOUT'
    })
  })

  it('formats Zod validation failures consistently', async () => {
    const app = createApp({
      config: createConfig(),
      logger: silentLogger
    })
    const route = createRoute({
      method: 'get',
      path: '/test/validation',
      request: {
        query: z.object({
          value: z.string().min(1)
        })
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: z.object({ value: z.string() })
            }
          },
          description: 'Validated value'
        }
      }
    })
    app.openapi(route, (c) => {
      return c.json(
        {
          value: c.req.valid('query').value
        },
        200
      )
    })

    const response = await app.request('/test/validation', {
      headers: authorization
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })

  it('records rejected and failed requests with their final HTTP status', async () => {
    const accessLogs: Array<Record<string, unknown>> = []
    const logger: Logger = {
      info(message, fields) {
        if (message === 'request completed') {
          accessLogs.push(fields ?? {})
        }
      },
      error() {}
    }
    const app = createApp({ config: createConfig(), logger })
    app.get('/test/failure', () => {
      throw new Error('internal details must not be exposed')
    })

    const unauthorized = await app.request('/v1/yiyan')
    const unauthorizedBody = await unauthorized.json() as Record<string, unknown>
    expect(unauthorized.status).toBe(401)
    expect(unauthorizedBody).toMatchObject({
      code: 'UNAUTHORIZED',
      data: null
    })
    expect(unauthorized.headers.get('x-openapi-error-code')).toBe('UNAUTHORIZED')

    const failed = await app.request('/test/failure', {
      headers: authorization
    })
    const failedBody = await failed.json() as Record<string, unknown>
    expect(failed.status).toBe(500)
    expect(Object.keys(failedBody).sort()).toEqual(['code', 'data', 'message', 'timestamp'])
    expect(failedBody).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '服务内部错误',
      data: null
    })
    expect(failed.headers.get('x-openapi-error-code')).toBe('INTERNAL_ERROR')

    expect(accessLogs).toEqual([
      expect.objectContaining({ status: 401, outcome: 'rejected' }),
      expect.objectContaining({ status: 500, outcome: 'error' })
    ])
  })
})
