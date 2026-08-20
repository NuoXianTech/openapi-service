import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  ConfigurationRevisionError,
  type ServiceConfigurationManager
} from '../../../configuration/manager.js'
import { ConfigurationValidationError } from '../../../configuration/values.js'
import {
  ConfigurationDefinitionSchema,
  ConfigurationFingerprintHeadersSchema,
  ConfigurationStateSchema,
  ConfigurationUpdateRequestSchema,
  ConfigurationUpdateResponseSchema
} from '../../../contracts/configuration.js'
import { ServiceError } from '../../errors.js'
import type { AppEnv } from '../../types.js'
import {
  errorResponse,
  matchesETag,
  unauthorizedResponse
} from './common.js'

const configurationSchemaRoute = createRoute({
  method: 'get',
  path: '/.well-known/configuration-schema.json',
  operationId: 'getServiceConfigurationDefinition',
  tags: ['System'],
  security: [{ serviceToken: [] }],
  responses: {
    200: {
      headers: ConfigurationFingerprintHeadersSchema,
      content: {
        'application/json': {
          schema: ConfigurationDefinitionSchema
        }
      },
      description: 'Declarative business configuration definition'
    },
    304: {
      headers: ConfigurationFingerprintHeadersSchema,
      description: 'Configuration definition has not changed'
    },
    401: unauthorizedResponse
  }
})

const configurationStateRoute = createRoute({
  method: 'get',
  path: '/.well-known/configuration.json',
  operationId: 'getServiceConfigurationState',
  tags: ['System'],
  security: [{ serviceToken: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ConfigurationStateSchema
        }
      },
      description: 'Current configuration with every secret redacted'
    },
    401: unauthorizedResponse
  }
})

const updateConfigurationRoute = createRoute({
  method: 'put',
  path: '/.well-known/configuration.json',
  operationId: 'updateServiceConfiguration',
  tags: ['System'],
  security: [{ serviceToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: ConfigurationUpdateRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: ConfigurationUpdateResponseSchema
        }
      },
      description: 'Configuration atomically persisted and applied'
    },
    400: errorResponse('Configuration values are invalid'),
    401: unauthorizedResponse,
    409: errorResponse('Configuration revision conflicts with active state')
  }
})

export function registerSystemConfigurationRoutes(
  app: OpenAPIHono<AppEnv>,
  configuration: ServiceConfigurationManager
): void {
  app.openapi(configurationSchemaRoute, (c) => {
    const sha256 = configuration.getSchemaSha256()
    const etag = `"sha256-${sha256}"`
    c.header('etag', etag)
    c.header('x-configuration-schema-sha256', sha256)
    c.header('cache-control', 'private, no-cache')
    c.header('vary', 'Authorization')
    if (matchesETag(c.req.header('if-none-match'), etag)) {
      return c.body(null, 304)
    }
    return c.json(configuration.getDefinition(), 200)
  })

  app.openapi(configurationStateRoute, (c) => {
    c.header('cache-control', 'private, no-store')
    return c.json(configuration.getRedactedState(), 200)
  })

  app.openapi(updateConfigurationRoute, async (c) => {
    const request = c.req.valid('json')
    try {
      const snapshot = await configuration.apply(
        request.revision,
        request.values
      )
      c.header('cache-control', 'private, no-store')
      return c.json({
        schemaVersion: 1 as const,
        serviceId: snapshot.serviceId,
        schemaSha256: snapshot.schemaSha256,
        revision: snapshot.revision,
        configurationSha256: snapshot.configurationSha256,
        updatedAt: snapshot.updatedAt ?? new Date().toISOString()
      }, 200)
    } catch (error) {
      if (error instanceof ConfigurationValidationError) {
        throw new ServiceError(
          400,
          'CONFIGURATION_INVALID',
          '服务配置校验失败',
          { field: error.field }
        )
      }
      if (error instanceof ConfigurationRevisionError) {
        throw new ServiceError(
          409,
          'CONFIGURATION_REVISION_CONFLICT',
          '服务配置版本冲突',
          { currentRevision: error.currentRevision }
        )
      }
      throw error
    }
  })
}
