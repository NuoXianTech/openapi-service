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
  request: { query: OutputEncodingQuerySchema },
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
    const encoding = parseOutputEncoding(c.req.valid('query'))
    if (!encoding) return respondWithInvalidEncoding(c) as never
    try {
      const data = await getGoldPrice(c.get('deadlineSignal'))
      const cacheControl = 'public, max-age=60'
      return respondWithEncoded(c, encoding, data, {
        message: '获取贵金属价格成功',
        text: formatGoldPriceText,
        markdown: formatGoldPriceMarkdown,
        cacheControl
      }) as never
    } catch (error) {
      if (c.get('deadlineSignal').aborted) throw c.get('deadlineSignal').reason
      const message = error instanceof Error ? error.message : '获取贵金属价格失败'
      return respondWithFailure(c, 502, 'UPSTREAM_ERROR', `获取贵金属价格失败：${message}`)
    }
  })
}
