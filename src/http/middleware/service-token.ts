import { timingSafeEqual } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import type { ServiceConfig } from '../../config/load.js'
import type { AppEnv } from '../../types/app.js'
import { respondWithFailure } from '../../shared/response.js'

const publicPaths = new Set(['/healthz', '/readyz'])

export function createServiceTokenMiddleware(config: ServiceConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (publicPaths.has(c.req.path)) {
      await next()
      return
    }

    const authorization = c.req.header('authorization') ?? ''
    const token = authorization.startsWith('Service ')
      ? authorization.slice('Service '.length).trim()
      : ''

    if (
      !constantTimeEqual(token, config.serviceToken) &&
      !(config.previousToken && constantTimeEqual(token, config.previousToken))
    ) {
      c.header('www-authenticate', 'Service realm="openapi-service"')
      return respondWithFailure(
        c,
        401,
        'UNAUTHORIZED',
        'Service 凭证无效或缺失'
      )
    }

    await next()
  })
}

function constantTimeEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)
  if (
    candidateBuffer.length === 0 ||
    candidateBuffer.length !== expectedBuffer.length
  ) {
    return false
  }
  return timingSafeEqual(candidateBuffer, expectedBuffer)
}
