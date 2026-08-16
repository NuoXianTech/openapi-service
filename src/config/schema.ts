import { z } from 'zod'

const optionalTokenSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined
    }
    return value
  },
  z.string().trim().min(32).optional()
)

export const environmentSchema = z
  .object({
    LISTEN_ADDR: z.string().trim().min(1).default(':8080'),
    API_SERVICE_TOKEN: z.string().trim().min(32),
    API_SERVICE_PREVIOUS_TOKEN: optionalTokenSchema,
    READ_HEADER_TIMEOUT: z.string().trim().min(1).default('5s'),
    REQUEST_TIMEOUT: z.string().trim().min(1).default('20s'),
    SHUTDOWN_TIMEOUT: z.string().trim().min(1).default('10s'),
    MAX_REQUEST_BODY_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024)
      .default(1024 * 1024),
    IP_DATABASE_DIRECTORY: z.string().trim().min(1).default('data/ip'),
    SERVICE_CONFIG_FILE: z
      .string()
      .trim()
      .min(1)
      .default('data/runtime/service-configuration.enc'),
    SERVICE_ID: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
      .default('openapi-service'),
    SERVICE_NAME: z.string().trim().min(1).max(160).default('OpenAPI Service'),
    SERVICE_VERSION: z.string().trim().min(1).default('dev'),
    SERVICE_COMMIT: z.string().trim().min(1).default('unknown')
  })
  .superRefine((value, context) => {
    if (
      value.API_SERVICE_PREVIOUS_TOKEN &&
      value.API_SERVICE_PREVIOUS_TOKEN === value.API_SERVICE_TOKEN
    ) {
      context.addIssue({
        code: 'custom',
        path: ['API_SERVICE_PREVIOUS_TOKEN'],
        message: 'must differ from API_SERVICE_TOKEN'
      })
    }
  })
