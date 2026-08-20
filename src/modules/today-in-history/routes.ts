import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure } from '../../shared/response.js'
import {
  OutputEncodingQuerySchema,
  parseOutputEncoding,
  respondWithEncoded,
  respondWithInvalidEncoding
} from '../../shared/output-encoding.js'
import type { AppEnv } from '../../http/types.js'
import {
  formatTodayInHistoryMarkdown,
  formatTodayInHistoryText,
  getTodayInHistory,
  parseTodayInHistoryDate
} from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/today-in-history',
  operationId: 'getTodayInHistory', tags: ['History'],
  security: [{ serviceToken: [] }],
  request: { query: OutputEncodingQuerySchema.extend({
    date: z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(z.object({
        date: z.string(), month: z.number().int(), day: z.number().int(),
        items: z.array(z.object({
          title: z.string(), year: z.string(), description: z.string(),
          event_type: z.enum(['birth', 'death', 'event']), link: z.string()
        })), total: z.number().int()
      })) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Historical events for a calendar day' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid date or encoding' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'History provider failed' }
  }
})

export function registerTodayInHistoryRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    const query = c.req.valid('query')
    const date = parseTodayInHistoryDate(query.date ?? '')
    if (!date) {
      return respondWithFailure(
        c, 400, 'INVALID_DATE',
        'date 必须是有效的 MM-DD 或 YYYY-MM-DD 日期'
      ) as never
    }
    const encoding = parseOutputEncoding(query)
    if (!encoding) return respondWithInvalidEncoding(c) as never
    try {
      const data = await getTodayInHistory(date, c.get('deadlineSignal'))
      return respondWithEncoded(c, encoding, data, {
        message: '获取历史上的今天成功',
        text: formatTodayInHistoryText,
        markdown: formatTodayInHistoryMarkdown,
        cacheControl: 'public, max-age=3600'
      }) as never
    } catch (error) {
      if (c.get('deadlineSignal').aborted) {
        throw c.get('deadlineSignal').reason
      }
      const message = error instanceof Error ? error.message : '获取历史事件失败'
      return respondWithFailure(
        c, 502, 'UPSTREAM_ERROR', `获取历史事件失败：${message}`
      ) as never
    }
  })
}
