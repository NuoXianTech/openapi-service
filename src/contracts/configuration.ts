import { z } from '@hono/zod-openapi'
export { ConfigurationDefinitionSchema } from '../configuration/definition-schema.js'

const ConfigurationValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.string())
])

const RedactedConfigurationValueSchema = z.union([
  ConfigurationValueSchema,
  z.object({ configured: z.boolean() })
])

export const ConfigurationStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: z.string(),
    schemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
    revision: z.number().int().nonnegative(),
    configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
    values: z.record(z.string(), RedactedConfigurationValueSchema),
    updatedAt: z.string().nullable()
  })
  .openapi('ServiceConfigurationState')

export const ConfigurationUpdateRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    values: z.record(z.string(), z.unknown())
  })
  .openapi('ServiceConfigurationUpdateRequest')

export const ConfigurationUpdateResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    serviceId: z.string(),
    schemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
    revision: z.number().int().positive(),
    configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
    updatedAt: z.string()
  })
  .openapi('ServiceConfigurationUpdateResponse')

export const ConfigurationFingerprintHeadersSchema = z.object({
  'x-configuration-schema-sha256': z.string().regex(/^[0-9a-f]{64}$/),
  etag: z.string()
})
