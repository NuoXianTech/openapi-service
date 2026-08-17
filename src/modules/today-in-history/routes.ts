import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
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
  request: { query: z.object({
    date: z.string().optional(), encode: z.string().optional(),
    encoding: z.string().optional()
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
    const encoding = (query.encode ?? query.encoding ?? 'json').toLowerCase()
    if (!['json', 'text', 'markdown', 'md'].includes(encoding)) {
      return respondWithFailure(
        c, 400, 'INVALID_ENCODING',
        'encode 必须是 json、text、markdown 或 md'
      ) as never
    }
    try {
      const data = await getTodayInHistory(date, c.get('deadlineSignal'))
      c.header('cache-control', 'public, max-age=3600')
      if (encoding === 'text') return c.text(formatTodayInHistoryText(data)) as never
      if (encoding === 'markdown' || encoding === 'md') {
        c.header('content-type', 'text/markdown; charset=UTF-8')
        return c.body(formatTodayInHistoryMarkdown(data)) as never
      }
      return respondWithSuccess(
        c, data, '获取历史上的今天成功', 'public, max-age=3600'
      )
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
