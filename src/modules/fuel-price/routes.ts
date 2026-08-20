import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import {
  OutputEncodingQuerySchema,
  parseOutputEncoding,
  respondWithEncoded,
  respondWithInvalidEncoding
} from '../../shared/output-encoding.js'
import type { AppEnv } from '../../http/types.js'
import {
  findFuelRegion,
  formatFuelPriceMarkdown,
  formatFuelPriceText,
  getFuelPriceData,
  listFuelRegions
} from './service.js'

const ItemSchema = z.object({
  name: z.string(), price: z.number(), price_desc: z.string()
})
const TrendSchema = z.object({
  next_adjustment_date: z.string(), direction: z.string(),
  change_ton: z.number(), change_ton_desc: z.string(),
  change_liter_min: z.number(), change_liter_max: z.number(),
  change_liter_desc: z.string(), description: z.string()
})
const DataSchema = z.object({
  region: z.string(), trend: TrendSchema.nullable(), items: z.array(ItemSchema),
  link: z.string(), updated: z.string(), updated_at: z.number().int()
})
const priceRoute = createRoute({
  method: 'get', path: '/v1/fuel-price', operationId: 'getFuelPrice',
  tags: ['Fuel Price'], security: [{ serviceToken: [] }],
  request: { query: OutputEncodingQuerySchema.extend({
    region: z.string().optional(), 'force-update': z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(DataSchema) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Fuel prices for a region' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Unsupported region' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Source unavailable' }
  }
})
const RegionSchema = z.object({ region: z.string(), url: z.string(), link: z.string() })
const regionsRoute = createRoute({
  method: 'get', path: '/v1/fuel-price/regions',
  operationId: 'listFuelPriceRegions', tags: ['Fuel Price'],
  'x-openapi-platform': { support: true },
  security: [{ serviceToken: [] }],
  request: { query: z.object({ keyword: z.string().optional() }) },
  responses: {
    200: { content: { 'application/json': { schema: createSuccessEnvelopeSchema(
      z.object({ total: z.number().int(), items: z.array(RegionSchema) })
    ) } }, description: 'Supported fuel-price regions' }
  }
})

function booleanFlag(value = ''): boolean {
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase())
}

export function registerFuelPriceRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(priceRoute, async (c) => {
    const query = c.req.valid('query')
    const keyword = query.region?.trim() || '北京'
    const region = findFuelRegion(keyword)
    if (!region) return respondWithFailure(c, 400, 'UNSUPPORTED_REGION', `暂不支持 ${keyword} 区域查询`) as never
    const forceUpdate = booleanFlag(query['force-update'])
    const encoding = parseOutputEncoding(query)
    if (!encoding) return respondWithInvalidEncoding(c) as never
    try {
      const data = await getFuelPriceData(region, forceUpdate, c.get('deadlineSignal'))
      const cacheControl = forceUpdate ? 'no-store' : 'public, max-age=3600'
      return respondWithEncoded(c, encoding, data, {
        message: '获取油价成功',
        text: formatFuelPriceText,
        markdown: formatFuelPriceMarkdown,
        cacheControl
      }) as never
    } catch (error) {
      if (c.get('deadlineSignal').aborted) throw c.get('deadlineSignal').reason
      const message = error instanceof Error ? error.message : '获取油价失败'
      return respondWithFailure(c, 502, 'UPSTREAM_ERROR', `获取油价失败：${message}`)
    }
  })
  app.openapi(regionsRoute, (c) => {
    const keyword = c.req.valid('query').keyword?.trim() ?? ''
    const items = listFuelRegions().filter(item => !keyword || item.region.includes(keyword))
    return respondWithSuccess(c, { total: items.length, items }, '获取油价地区列表成功')
  })
}
