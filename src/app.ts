import { OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfig } from './config.js'
import { createInMemoryConfigurationManager } from './configuration/create.js'
import type { ServiceConfigurationManager } from './configuration/manager.js'
import {
  createJsonLogger,
  type Logger
} from './shared/logger.js'
import {
  createAccessLogMiddleware,
  requestContextMiddleware
} from './http/middleware/request-context.js'
import {
  createBodyLimitMiddleware,
  createDeadlineMiddleware
} from './http/middleware/request-limits.js'
import { createServiceTokenMiddleware } from './http/middleware/service-token.js'
import { registerSystemRoutes } from './http/routes/system.js'
import {
  registerServiceModules,
  serviceConfigurationDefinition
} from './modules/index.js'
import {
  normalizeServiceError,
  respondWithError
} from './http/errors.js'
import type { AppEnv } from './http/types.js'
import { RuntimeState } from './runtime-state.js'
import { respondWithFailure } from './shared/response.js'

export interface CreateAppOptions {
  config: ServiceConfig
  logger?: Logger
  runtimeState?: RuntimeState
  configuration?: ServiceConfigurationManager
}

export function createApp(options: CreateAppOptions) {
  const logger = options.logger ?? createJsonLogger()
  const runtimeState = options.runtimeState ?? new RuntimeState()
  const configuration = options.configuration
    ?? createInMemoryConfigurationManager(
      options.config,
      serviceConfigurationDefinition
    )
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return respondWithFailure(
          c,
          400,
          'INVALID_ARGUMENT',
          '请求参数校验失败',
          { target: result.target }
        )
      }
    }
  })

  app.use('*', requestContextMiddleware)
  app.use('*', createAccessLogMiddleware(logger))
  app.use('*', createServiceTokenMiddleware(options.config))
  app.use(
    '*',
    createBodyLimitMiddleware(options.config.maxRequestBodyBytes)
  )
  app.use(
    '*',
    createDeadlineMiddleware(options.config.requestTimeoutMs)
  )

  registerSystemRoutes(app, options.config, runtimeState, configuration)
  registerServiceModules(app, options.config, configuration)

  app.notFound((c) => {
    return respondWithFailure(c, 404, 'NOT_FOUND', '接口不存在')
  })

  app.onError((error, c) => {
    const serviceError = normalizeServiceError(error)
    logger.error('request failed unexpectedly', {
      request_id: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      code: serviceError.code,
      status: serviceError.status,
      error_name:
        error instanceof Error ? error.name : 'UnknownError'
    })
    return respondWithError(c, serviceError)
  })

  return app
}
