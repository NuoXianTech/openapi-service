import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import { respondWithFailure } from '../../shared/response.js'
import {
  OutputEncodingQuerySchema,
  parseOutputEncoding,
  respondWithEncoded,
  respondWithInvalidEncoding
} from '../../shared/output-encoding.js'
import type { AppEnv } from '../../http/types.js'
import {
  createBingMarkdown,
  getBingImage,
  isBingImageType,
  resolveBingCoverUrl,
  type BingImageType
} from './service.js'

const BingImageSchema = z.object({
  title: z.string(),
  headline: z.string(),
  description: z.string(),
  cover: z.string().url(),
  cover_4k: z.string().url(),
  main_text: z.string(),
  copyright: z.string(),
  update_date: z.string(),
  update_date_at: z.number().int().nonnegative()
})
const BingSuccessSchema = createSuccessEnvelopeSchema(BingImageSchema)
const bingRoute = createRoute({
  method: 'get',
  path: '/v1/bing',
  operationId: 'getBingDailyImage',
  tags: ['Bing'],
  security: [{ serviceToken: [] }],
  request: {
    query: OutputEncodingQuerySchema.extend({
      type: z.string().optional()
    })
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: BingSuccessSchema },
        'text/plain': { schema: z.string() },
        'text/markdown': { schema: z.string() }
      },
      description: 'Bing daily image metadata or raw representation'
    },
    302: { description: 'Redirect to the selected Bing image' },
    502: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Bing sources are unavailable'
    }
  }
})

function parseImageType(value: string): BingImageType {
  const normalized = value.trim().toLowerCase()
  return isBingImageType(normalized) ? normalized : 'auto'
}

export function registerBingRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(bingRoute, async (c) => {
    const query = c.req.valid('query')
    const encode = parseOutputEncoding(query, ['image', 'image-4k'] as const)
    if (!encode) return respondWithInvalidEncoding(c) as never
    const imageType = parseImageType(query.type ?? '')
    const signal = c.get('deadlineSignal')
    try {
      const data = await getBingImage(signal)
      const record = {
        ...data,
        cover: resolveBingCoverUrl(
          data.cover,
          imageType,
          c.req.header('user-agent') ?? ''
        )
      }
      const cacheControl = 'public, max-age=3600'
      if (encode === 'image' || encode === 'image-4k') {
        c.header('cache-control', cacheControl)
        return c.redirect(
          encode === 'image-4k' ? data.cover_4k : record.cover,
          302
        ) as never
      }
      return respondWithEncoded(
        c,
        encode,
        record,
        {
          message: '获取必应每日壁纸成功',
          text: item => item.cover,
          markdown: createBingMarkdown,
          cacheControl
        }
      ) as never
    } catch (error) {
      if (signal.aborted) throw signal.reason
      const message = error instanceof Error
        ? error.message
        : '获取必应每日壁纸失败'
      return respondWithFailure(
        c,
        502,
        'UPSTREAM_ERROR',
        `获取必应每日壁纸失败：${message}`
      )
    }
  })
}
