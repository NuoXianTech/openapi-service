import { z } from '@hono/zod-openapi'
import type { ZodType } from 'zod'

export function createApiEnvelopeSchema<TSchema extends ZodType>(
  dataSchema: TSchema
) {
  return z.object({
    code: z.string(),
    message: z.string(),
    data: dataSchema.nullable(),
    timestamp: z.number().int()
  })
}

export const ApiErrorResponseSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    data: z
      .record(
        z.string(),
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null()
        ])
      )
      .nullable(),
    timestamp: z.number().int()
  })
  .openapi('ApiErrorResponse')
