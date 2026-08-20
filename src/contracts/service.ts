import { z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema } from '../shared/openapi.js'

export const SERVICE_CONTROL_PROTOCOL_V1 = 'openapi-service/v1' as const

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok')
  })
  .openapi('HealthResponse')

export const ReadinessResponseSchema = z
  .object({
    status: z.literal('ready')
  })
  .openapi('ReadinessResponse')

export const ReadinessUnavailableSchema = z
  .object({
    status: z.literal('not_ready'),
    reason: z.string()
  })
  .openapi('ReadinessUnavailable')

export const ServiceDescriptionSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: z.string().min(1).max(120),
    name: z.string().min(1).max(160),
    version: z.string().min(1).max(160),
    commit: z.string().min(1).max(160),
    openapi: z.literal('/openapi.json'),
    openapiSha256: z.string().regex(/^[0-9a-f]{64}$/),
    health: z.literal('/healthz'),
    readiness: z.literal('/readyz'),
    configuration: z.object({
      schema: z.literal('/.well-known/configuration-schema.json'),
      state: z.literal('/.well-known/configuration.json'),
      update: z.literal('/.well-known/configuration.json'),
      schemaSha256: z.string().regex(/^[0-9a-f]{64}$/)
    }),
    serviceProtocol: z.literal(SERVICE_CONTROL_PROTOCOL_V1)
  })
  .openapi('ServiceDescription')

export const ErrorResponseSchema = ApiErrorResponseSchema

export const OpenAPIDocumentSchema = z
  .record(z.string(), z.unknown())
  .openapi('OpenAPIDocument')

export const ContractFingerprintHeadersSchema = z.object({
  'x-openapi-sha256': z.string().regex(/^[0-9a-f]{64}$/)
})

export const OpenAPIResponseHeadersSchema =
  ContractFingerprintHeadersSchema.extend({
    etag: z.string()
  })
