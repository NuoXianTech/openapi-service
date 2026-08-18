import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../http/types.js'
import {
  formatExchangeRateMarkdown,
  formatExchangeRateText,
  getExchangeRates,
  normalizeCurrencyCode
} from './service.js'

const DataSchema = z.object({
  base_code: z.string(), updated: z.string(), updated_at: z.number().int(),
  next_updated: z.string(), next_updated_at: z.number().int(),
  rates: z.array(z.object({ currency: z.string(), rate: z.number() }))
})
const route = createRoute({
  method: 'get', path: '/v1/exchange-rate',
  operationId: 'getExchangeRates', tags: ['Exchange Rate'],
  security: [{ serviceToken: [] }],
  request: { query: z.object({
    currency: z.string().optional(), encode: z.string().optional(),
    encoding: z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(DataSchema) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Exchange rates' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Invalid currency' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Source unavailable' }
  }
})

export function registerExchangeRateRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    const query = c.req.valid('query')
    const currency = normalizeCurrencyCode(query.currency ?? 'CNY')
    if (!currency) return respondWithFailure(c, 400, 'INVALID_CURRENCY', 'currency 必须是 ISO 4217 三位货币代码') as never
    try {
      const data = await getExchangeRates(currency)
      const encoding = (query.encode ?? query.encoding ?? '').toLowerCase()
      const cacheControl = 'public, max-age=3600'
      if (encoding === 'text') {
        c.header('cache-control', cacheControl)
        return c.text(formatExchangeRateText(data)) as never
      }
      if (encoding === 'markdown' || encoding === 'md') {
        c.header('cache-control', cacheControl)
        c.header('content-type', 'text/markdown; charset=UTF-8')
        return c.body(formatExchangeRateMarkdown(data)) as never
      }
      return respondWithSuccess(c, data, '获取汇率成功', cacheControl)
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取汇率失败'
      return respondWithFailure(c, 502, 'UPSTREAM_ERROR', `获取汇率失败：${message}`)
    }
  })
}
