import { z } from '@hono/zod-openapi'
import type { ZodType } from 'zod'

export function createSuccessEnvelopeSchema<TSchema extends ZodType>(
  dataSchema: TSchema
) {
  return z.object({
    code: z.literal('OK'),
    message: z.string().min(1),
    data: dataSchema.nullable(),
    timestamp: z.number().int().nonnegative()
  })
}

export const ApiErrorResponseSchema = z
  .object({
    code: z.string(),
    message: z.string().min(1),
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
    timestamp: z.number().int().nonnegative()
  })
  .openapi('ApiErrorResponse')
