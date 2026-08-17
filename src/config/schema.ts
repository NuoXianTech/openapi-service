import { z } from 'zod'

export const environmentSchema = z.object({
  LISTEN_ADDR: z.string().trim().min(1).default(':8080'),
  API_SERVICE_TOKEN: z.string().trim().min(32),
  SERVICE_DATA_DIR: z.string().trim().min(1).default('data'),
  SERVICE_ID: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
    .default('openapi-service'),
  SERVICE_NAME: z.string().trim().min(1).max(160).default('OpenAPI Service'),
  SERVICE_VERSION: z.string().trim().min(1).optional(),
  SERVICE_COMMIT: z.string().trim().min(1).default('unknown')
})
