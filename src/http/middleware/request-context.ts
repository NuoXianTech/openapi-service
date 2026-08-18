import { randomUUID } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { Logger } from '../../shared/logger.js'
import type { AppEnv } from '../types.js'

const requestIDPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const requestContextMiddleware = createMiddleware<AppEnv>(
  async (c, next) => {
    const incomingRequestID = c.req.header('x-request-id')?.trim()
    const requestID =
      incomingRequestID && requestIDPattern.test(incomingRequestID)
        ? incomingRequestID.toLowerCase()
        : randomUUID()

    c.set('requestId', requestID)
    c.header('x-request-id', requestID)
    await next()
  }
)

export function createAccessLogMiddleware(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const startedAt = performance.now()
    let threw = false

    try {
      await next()
    } catch (error) {
      threw = true
      throw error
    } finally {
      const status = c.res.status
      const outcome = threw || status >= 500
        ? 'error'
        : status >= 400
          ? 'rejected'
          : 'completed'
      logger.info('request completed', {
        request_id: c.get('requestId'),
        traceparent: c.req.header('traceparent'),
        platform_route_id: c.req.header('x-openapi-route-id'),
        platform_upstream_id: c.req.header('x-openapi-upstream-id'),
        platform_environment_id: c.req.header('x-openapi-environment-id'),
        platform_revision_id: c.req.header('x-openapi-revision-id'),
        platform_product_id: c.req.header('x-openapi-product-id'),
        platform_product_slug: c.req.header('x-openapi-product-slug'),
        platform_api_version: c.req.header('x-openapi-api-version'),
        method: c.req.method,
        path: c.req.path,
        status,
        outcome,
        duration_ms: Math.round((performance.now() - startedAt) * 100) / 100
      })
    }
  })
}
