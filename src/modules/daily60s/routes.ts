import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import {
  respondWithFailure,
  respondWithSuccess
} from '../../shared/response.js'
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
const Daily60sQuerySchema = z.object({
  date: z.string().optional(),
  encode: z.string().optional(),
  encoding: z.string().optional()
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

type Daily60sEncoding = 'json' | 'text' | 'markdown'

function parseEncoding(value: string): Daily60sEncoding | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'json') return 'json'
  if (normalized === 'text') return 'text'
  if (normalized === 'markdown' || normalized === 'md') return 'markdown'
  return null
}

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
    const encoding = parseEncoding(query.encode ?? query.encoding ?? '')
    if (!encoding) {
      return respondWithFailure(
        c,
        400,
        'INVALID_ENCODING',
        'encode 必须是 json、text、markdown 或 md'
      )
    }

    const signal = c.get('deadlineSignal')
    try {
      const data = await getDaily60s(date, {
        fallback: rawDate.length === 0,
        signal
      })
      c.header('cache-control', 'public, max-age=900')
      if (encoding === 'text') return c.text(formatDaily60sText(data)) as never
      if (encoding === 'markdown') {
        c.header('content-type', 'text/markdown; charset=UTF-8')
        return c.body(formatDaily60sMarkdown(data)) as never
      }
      return respondWithSuccess(
        c,
        data,
        '获取每日 60 秒成功',
        'public, max-age=900'
      )
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
