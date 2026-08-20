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
  formatEpicMarkdown,
  formatEpicText,
  getEpicFreeGames
} from './service.js'

const GameSchema = z.object({
  id: z.string(),
  title: z.string(),
  cover: z.string(),
  original_price: z.number().nonnegative(),
  original_price_desc: z.string(),
  description: z.string(),
  seller: z.string(),
  is_free_now: z.boolean(),
  free_start: z.string(),
  free_start_at: z.number().int().nonnegative(),
  free_end: z.string(),
  free_end_at: z.number().int().nonnegative(),
  link: z.string()
})
const route = createRoute({
  method: 'get',
  path: '/v1/epic',
  operationId: 'getEpicFreeGames',
  tags: ['Epic'],
  security: [{ serviceToken: [] }],
  request: {
    query: OutputEncodingQuerySchema
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessEnvelopeSchema(z.array(GameSchema))
        },
        'text/plain': { schema: z.string() },
        'text/markdown': { schema: z.string() }
      },
      description: 'Current and upcoming Epic free games'
    },
    502: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Epic source unavailable'
    }
  }
})

export function registerEpicRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    const query = c.req.valid('query')
    const encoding = parseOutputEncoding(query)
    if (!encoding) return respondWithInvalidEncoding(c) as never
    try {
      const games = await getEpicFreeGames(c.get('deadlineSignal'))
      const cacheControl = 'public, max-age=300'
      return respondWithEncoded(
        c,
        encoding,
        games,
        {
          message: '获取 Epic 免费游戏成功',
          text: formatEpicText,
          markdown: formatEpicMarkdown,
          cacheControl
        }
      ) as never
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : '获取 Epic 免费游戏失败'
      return respondWithFailure(
        c,
        502,
        'UPSTREAM_ERROR',
        `获取 Epic 免费游戏失败：${message}`
      )
    }
  })
}
