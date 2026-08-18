import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../http/types.js'
import { formatLuckMarkdown, formatLuckText, getLuck, parseLuckId } from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/luck', operationId: 'getDailyLuck',
  tags: ['Luck'], security: [{ serviceToken: [] }],
  request: { query: z.object({
    id: z.string().optional(), encode: z.string().optional(),
    encoding: z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(z.object({
        id: z.number().int(), category: z.string(), rank: z.number().int(),
        tip: z.string(), tip_index: z.number().int()
      })) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Random luck tip' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Invalid category ID' },
    404: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Category not found' }
  }
})

export function registerLuckRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, (c) => {
    const query = c.req.valid('query')
    const id = parseLuckId(query.id ?? '')
    if (id === null) return respondWithFailure(c, 400, 'INVALID_ID', 'id 必须是非负整数且不能包含前导零') as never
    const data = getLuck(id)
    if (!data) return respondWithFailure(c, 404, 'LUCK_NOT_FOUND', `未找到 id 为 ${id} 的运势`) as never
    const encoding = (query.encode ?? query.encoding ?? '').toLowerCase()
    c.header('cache-control', 'no-store')
    c.header('pragma', 'no-cache')
    if (encoding === 'text') return c.text(formatLuckText(data)) as never
    if (encoding === 'markdown' || encoding === 'md') {
      c.header('content-type', 'text/markdown; charset=UTF-8')
      return c.body(formatLuckMarkdown(data)) as never
    }
    return respondWithSuccess(c, data, '获取今日运势成功')
  })
}
