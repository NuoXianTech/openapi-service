import {
  createRoute,
  type OpenAPIHono
} from '@hono/zod-openapi'
import type { ServiceConfig } from '../../config.js'
import {
  ConfigurationRevisionError,
  type ServiceConfigurationManager
} from '../../configuration/manager.js'
import { ConfigurationValidationError } from '../../configuration/values.js'
import {
  ConfigurationDefinitionSchema,
  ConfigurationFingerprintHeadersSchema,
  ConfigurationStateSchema,
  ConfigurationUpdateRequestSchema,
  ConfigurationUpdateResponseSchema
} from '../../contracts/configuration.js'
import {
  createOpenAPIContract,
  SERVICE_OPENAPI_VERSION
} from '../../contracts/openapi.js'
import {
  ContractFingerprintHeadersSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  OpenAPIDocumentSchema,
  OpenAPIResponseHeadersSchema,
  ReadinessResponseSchema,
  ReadinessUnavailableSchema,
  ServiceDescriptionSchema
} from '../../contracts/service.js'
import type { RuntimeState } from '../../runtime-state.js'
import type { AppEnv } from '../types.js'
import { ServiceError } from '../errors.js'

function errorResponse(description: string) {
  return {
    content: {
      'application/json': {
        schema: ErrorResponseSchema
      }
    },
    description
  } as const
}

const unauthorizedResponse = errorResponse(
  'Service Token is missing or invalid'
)

function matchesETag(header: string | undefined, etag: string): boolean {
  return header?.split(',').some(value => value.trim() === etag) === true
}

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

const descriptionRoute = createRoute({
  method: 'get',
  path: '/.well-known/service.json',
  operationId: 'getServiceDescription',
  tags: ['System'],
  security: [{ serviceToken: [] }],
  responses: {
    200: {
      headers: ContractFingerprintHeadersSchema,
      content: {
        'application/json': {
          schema: ServiceDescriptionSchema
        }
      },
      description: 'Versioned service metadata'
    },
    401: unauthorizedResponse
  }
})

const openAPIRoute = createRoute({
  method: 'get',
  path: '/openapi.json',
  operationId: 'getOpenAPIDocument',
  tags: ['System'],
  security: [{ serviceToken: [] }],
  responses: {
    200: {
      headers: OpenAPIResponseHeadersSchema,
      content: {
        'application/json': {
          schema: OpenAPIDocumentSchema
        }
      },
      description: 'OpenAPI 3.1 service contract'
    },
    304: {
      headers: OpenAPIResponseHeadersSchema,
      description: 'Contract has not changed'
    },
    401: unauthorizedResponse
  }
})

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
      description: 'Configuration durably applied'
    },
    400: errorResponse('Configuration values are invalid'),
    401: unauthorizedResponse,
    409: errorResponse('Configuration revision conflicts with active state')
  }
})

export function registerSystemRoutes(
  app: OpenAPIHono<AppEnv>,
  config: ServiceConfig,
  runtimeState: RuntimeState,
  configuration: ServiceConfigurationManager
) {
  app.openAPIRegistry.registerComponent(
    'securitySchemes',
    'serviceToken',
    {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Authorization: Service <token>'
    }
  )

  let contract:
    | ReturnType<typeof createOpenAPIContract>
    | undefined
  const getContract = () => {
    contract ??= createOpenAPIContract(
      app.getOpenAPI31Document({
        openapi: '3.1.0',
        info: {
          title: config.serviceName,
          version: SERVICE_OPENAPI_VERSION,
          description:
            'Independent business API upstream for OpenAPI Platform'
        }
      }) as unknown as Record<string, unknown>
    )
    return contract
  }

  app.openapi(healthRoute, (c) => c.json({ status: 'ok' }, 200))
  app.openapi(readinessRoute, (c) => {
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
  app.openapi(descriptionRoute, (c) => {
    const openAPIContract = getContract()
    c.header('x-openapi-sha256', openAPIContract.sha256)
    return c.json(
      {
        schemaVersion: 1,
        serviceId: config.serviceId,
        name: config.serviceName,
        version: config.version,
        commit: config.commit,
        openapi: '/openapi.json',
        openapiSha256: openAPIContract.sha256,
        health: '/healthz',
        readiness: '/readyz',
        configuration: {
          schema: '/.well-known/configuration-schema.json',
          state: '/.well-known/configuration.json',
          update: '/.well-known/configuration.json',
          schemaSha256: configuration.getSchemaSha256()
        },
        platformProtocol: 'openapi-platform-service/v1'
      },
      200
    )
  })

  app.openapi(openAPIRoute, (c) => {
    const openAPIContract = getContract()
    c.header('etag', openAPIContract.etag)
    c.header('x-openapi-sha256', openAPIContract.sha256)
    c.header('cache-control', 'private, no-cache')
    c.header('vary', 'Authorization')

    if (matchesETag(
      c.req.header('if-none-match'),
      openAPIContract.etag
    )) {
      return c.body(null, 304)
    }

    return c.json(openAPIContract.document, 200)
  })

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
