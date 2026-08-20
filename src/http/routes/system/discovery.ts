import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfig } from '../../../config.js'
import type { ServiceConfigurationManager } from '../../../configuration/manager.js'
import {
  createOpenAPIContract,
  SERVICE_OPENAPI_VERSION
} from '../../../contracts/openapi.js'
import {
  ContractFingerprintHeadersSchema,
  OpenAPIDocumentSchema,
  OpenAPIResponseHeadersSchema,
  ServiceDescriptionSchema
} from '../../../contracts/service.js'
import type { AppEnv } from '../../types.js'
import { matchesETag, unauthorizedResponse } from './common.js'

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

export function registerSystemDiscoveryRoutes(
  app: OpenAPIHono<AppEnv>,
  config: ServiceConfig,
  configuration: ServiceConfigurationManager
): void {
  let contract: ReturnType<typeof createOpenAPIContract> | undefined
  const getContract = () => {
    contract ??= createOpenAPIContract(
      app.getOpenAPI31Document({
        openapi: '3.1.0',
        info: {
          title: config.serviceName,
          version: SERVICE_OPENAPI_VERSION,
          description: 'Independent business API upstream for OpenAPI Platform'
        }
      }) as unknown as Record<string, unknown>
    )
    return contract
  }

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

    if (matchesETag(c.req.header('if-none-match'), openAPIContract.etag)) {
      return c.body(null, 304)
    }
    return c.json(openAPIContract.document, 200)
  })
}
