import { z } from '@hono/zod-openapi'

const configurationKeyPattern =
  /^[a-z][A-Za-z0-9]*(?:[._-][a-z][A-Za-z0-9]*)*$/

const ConfigurationOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional()
})

const ConfigurationFieldBase = {
  key: z.string().regex(configurationKeyPattern),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional()
}

const ConfigurationFieldSchema = z.discriminatedUnion('type', [
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('boolean'),
    default: z.boolean()
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.enum(['text', 'textarea']),
    default: z.string(),
    placeholder: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional()
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('secret'),
    placeholder: z.string().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional()
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('number'),
    default: z.number(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    step: z.number().positive().optional()
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('single-select'),
    default: z.string(),
    options: z.array(ConfigurationOptionSchema).min(1)
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('multi-select'),
    default: z.array(z.string()),
    options: z.array(ConfigurationOptionSchema).min(1)
  })
])

export const ConfigurationDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(z.object({
      key: z.string().regex(configurationKeyPattern),
      label: z.string(),
      description: z.string().optional(),
      fields: z.array(ConfigurationFieldSchema)
    }))
  })
  .openapi('ServiceConfigurationDefinition')

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
