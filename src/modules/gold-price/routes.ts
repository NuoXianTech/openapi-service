import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import { formatGoldPriceMarkdown, formatGoldPriceText, getGoldPrice } from './service.js'

const CommonSchema = z.object({
  price: z.string(), unit: z.string(), formatted: z.string(),
  updated: z.string(), updated_at: z.number().int()
})
const DataSchema = z.object({
  date: z.string(),
  metals: z.array(z.object({
    name: z.string(), sell_price: z.string(), today_price: z.string(),
    high_price: z.string(), low_price: z.string(), unit: z.string(),
    updated: z.string(), updated_at: z.number().int()
  })),
  stores: z.array(CommonSchema.extend({ brand: z.string(), product: z.string() })),
  banks: z.array(CommonSchema.extend({
    bank: z.string(), product: z.string(), time: z.string()
  })),
  recycle: z.array(CommonSchema.extend({ type: z.string(), purity: z.string() }))
})
const route = createRoute({
  method: 'get', path: '/v1/gold-price', operationId: 'getGoldPrice',
  tags: ['Gold Price'], security: [{ serviceToken: [] }],
  request: { query: z.object({
    encode: z.string().optional(), encoding: z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(DataSchema) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Current precious metal prices' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Source unavailable' }
  }
})

export function registerGoldPriceRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    try {
      const data = await getGoldPrice(c.get('deadlineSignal'))
      const query = c.req.valid('query')
      const encoding = (query.encode ?? query.encoding ?? '').toLowerCase()
      const cacheControl = 'public, max-age=60'
      if (encoding === 'text') {
        c.header('cache-control', cacheControl)
        return c.text(formatGoldPriceText(data)) as never
      }
      if (encoding === 'markdown' || encoding === 'md') {
        c.header('cache-control', cacheControl)
        c.header('content-type', 'text/markdown; charset=UTF-8')
        return c.body(formatGoldPriceMarkdown(data)) as never
      }
      return respondWithSuccess(c, data, '获取贵金属价格成功', cacheControl)
    } catch (error) {
      if (c.get('deadlineSignal').aborted) throw c.get('deadlineSignal').reason
      const message = error instanceof Error ? error.message : '获取贵金属价格失败'
      return respondWithFailure(c, 502, 'UPSTREAM_ERROR', `获取贵金属价格失败：${message}`)
    }
  })
}
