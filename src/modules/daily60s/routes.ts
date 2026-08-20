import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import {
  respondWithFailure,
} from '../../shared/response.js'
import {
  OutputEncodingQuerySchema,
  parseOutputEncoding,
  respondWithEncoded,
  respondWithInvalidEncoding
} from '../../shared/output-encoding.js'
import type { AppEnv } from '../../http/types.js'
import {
  formatDaily60sMarkdown,
  formatDaily60sText,
  getDaily60s,
  parseDaily60sDate
} from './service.js'

const Daily60sDataSchema = z.object({
  date: z.string(),
  news: z.array(z.string()),
  cover: z.string(),
  tip: z.string(),
  link: z.string(),
  created: z.string(),
  created_at: z.number().int().nonnegative(),
  updated: z.string(),
  updated_at: z.number().int().nonnegative(),
  day_of_week: z.string(),
  lunar_date: z.string(),
  api_updated: z.string(),
  api_updated_at: z.number().int().nonnegative()
})
const Daily60sSuccessSchema = createSuccessEnvelopeSchema(Daily60sDataSchema)
const Daily60sQuerySchema = OutputEncodingQuerySchema.extend({
  date: z.string().optional()
})
const daily60sRoute = createRoute({
  method: 'get',
  path: '/v1/60s',
  operationId: 'getDaily60s',
  tags: ['Daily 60s'],
  security: [{ serviceToken: [] }],
  request: { query: Daily60sQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: Daily60sSuccessSchema },
        'text/plain': { schema: z.string() },
        'text/markdown': { schema: z.string() }
      },
      description: 'Daily news in the requested representation'
    },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid date or representation'
    },
    502: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Daily news source is unavailable'
    }
  }
})

export function registerDaily60sRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(daily60sRoute, async (c) => {
    const query = c.req.valid('query')
    const rawDate = query.date?.trim() ?? ''
    const date = parseDaily60sDate(rawDate)
    if (!date) {
      return respondWithFailure(
        c,
        400,
        'INVALID_DATE',
        'date 必须是有效的 YYYY-MM-DD 日期'
      )
    }
    const encoding = parseOutputEncoding(query)
    if (!encoding) {
      return respondWithInvalidEncoding(c)
    }

    const signal = c.get('deadlineSignal')
    try {
      const data = await getDaily60s(date, {
        fallback: rawDate.length === 0,
        signal
      })
      return respondWithEncoded(
        c,
        encoding,
        data,
        {
          message: '获取每日 60 秒成功',
          text: formatDaily60sText,
          markdown: formatDaily60sMarkdown,
          cacheControl: 'public, max-age=900'
        }
      ) as never
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const message = error instanceof Error
        ? error.message
        : '获取每日 60 秒失败'
      return respondWithFailure(
        c,
        502,
        'UPSTREAM_ERROR',
        `获取每日 60 秒失败：${message}`
      )
    }
  })
}
