import { z } from '@hono/zod-openapi'

const ConfigurationKeySchema = z.string()
  .min(1)
  .max(160)
  .regex(/^[a-z][A-Za-z0-9]*(?:[._-][a-z][A-Za-z0-9]*)*$/)

const ConfigurationOptionSchema = z.object({
  label: z.string().min(1).max(300),
  value: z.string().min(1).max(500),
  description: z.string().max(1000).optional()
})

const ConfigurationFieldBase = {
  key: ConfigurationKeySchema,
  label: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
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
    default: z.string().max(100_000),
    placeholder: z.string().max(1000).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().max(100_000).optional()
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('secret'),
    placeholder: z.string().max(1000).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().max(100_000).optional()
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
    options: z.array(ConfigurationOptionSchema).min(1).max(500)
  }),
  z.object({
    ...ConfigurationFieldBase,
    type: z.literal('multi-select'),
    default: z.array(z.string()).max(500),
    options: z.array(ConfigurationOptionSchema).min(1).max(500)
  })
])

export const ConfigurationDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    groups: z.array(z.object({
      key: ConfigurationKeySchema,
      label: z.string().min(1).max(300),
      description: z.string().max(2000).optional(),
      fields: z.array(ConfigurationFieldSchema).max(1000)
    })).max(200)
  })
  .openapi('ServiceConfigurationDefinition')
