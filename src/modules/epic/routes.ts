import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
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
    query: z.object({
      encode: z.string().optional(),
      encoding: z.string().optional()
    })
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
    const encoding = (query.encode ?? query.encoding ?? '')
      .trim().toLowerCase()
    try {
      const games = await getEpicFreeGames(c.get('deadlineSignal'))
      const cacheControl = 'public, max-age=300'
      if (encoding === 'text') {
        c.header('cache-control', cacheControl)
        return c.text(formatEpicText(games)) as never
      }
      if (encoding === 'markdown' || encoding === 'md') {
        c.header('cache-control', cacheControl)
        c.header('content-type', 'text/markdown; charset=UTF-8')
        return c.body(formatEpicMarkdown(games)) as never
      }
      return respondWithSuccess(
        c,
        games,
        '获取 Epic 免费游戏成功',
        cacheControl
      )
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
