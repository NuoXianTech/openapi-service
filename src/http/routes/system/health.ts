import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
  ReadinessUnavailableSchema
} from '../../../contracts/service.js'
import type { RuntimeState } from '../../../runtime-state.js'
import type { AppEnv } from '../../types.js'

const healthRoute = createRoute({
  method: 'get',
  path: '/healthz',
  operationId: 'getHealth',
  tags: ['System'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: HealthResponseSchema
        }
      },
      description: 'Process is alive'
    }
  }
})

const readinessRoute = createRoute({
  method: 'get',
  path: '/readyz',
  operationId: 'getReadiness',
  tags: ['System'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ReadinessResponseSchema
        }
      },
      description: 'Service is ready to receive traffic'
    },
    503: {
      content: {
        'application/json': {
          schema: ReadinessUnavailableSchema
        }
      },
      description: 'Service is starting or shutting down'
    }
  }
})

export function registerSystemHealthRoutes(
  app: OpenAPIHono<AppEnv>,
  runtimeState: RuntimeState
): void {
  app.openapi(healthRoute, (c) => {
    c.header('cache-control', 'no-store')
    return c.json({ status: 'ok' }, 200)
  })
  app.openapi(readinessRoute, (c) => {
    c.header('cache-control', 'no-store')
    const readiness = runtimeState.getReadiness()
    if (!readiness.ready) {
      return c.json(
        {
          status: 'not_ready',
          reason: readiness.reason ?? 'not_ready'
        },
        503
      )
    }
    return c.json({ status: 'ready' }, 200)
  })
}
