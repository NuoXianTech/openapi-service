import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'smoke-token-that-is-at-least-32-characters'

const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken,
  readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000,
  maxRequestBodyBytes: 1024 * 1024,
  ipDatabaseDirectory: 'data/ip',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'openapi-service-test',
  serviceName: 'OpenAPI Service Test',
  version: 'smoke-test',
  commit: 'test-commit'
}

const silentLogger: Logger = {
  info() {},
  error() {}
}

describe('Node HTTP adapter', () => {
  it('serves health and protected OpenAPI over a real socket', async () => {
    const app = createApp({ config, logger: silentLogger })
    let server!: Server
    const port = await new Promise<number>((resolve) => {
      server = serve(
        {
          fetch: app.fetch,
          hostname: '127.0.0.1',
          port: 0
        },
        (info) => resolve(info.port)
      ) as Server
    })

    try {
      const health = await fetch('http://127.0.0.1:' + port + '/healthz')
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ status: 'ok' })

      const unauthorized = await fetch(
        'http://127.0.0.1:' + port + '/openapi.json'
      )
      expect(unauthorized.status).toBe(401)

      const authorized = await fetch(
        'http://127.0.0.1:' + port + '/openapi.json',
        {
          headers: {
            authorization: 'Service ' + serviceToken
          }
        }
      )
      const document = (await authorized.json()) as { openapi: string }
      expect(authorized.status).toBe(200)
      expect(document.openapi).toBe('3.1.0')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })
})
