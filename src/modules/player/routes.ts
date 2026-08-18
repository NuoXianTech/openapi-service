import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { respondWithFailure } from '../../shared/response.js'
import { ApiErrorResponseSchema } from '../../shared/openapi.js'
import type { AppEnv } from '../../http/types.js'
import { readPlayerAsset } from './assets.js'
import { renderArtplayerHTML, renderDplayerHTML } from './html.js'
import { parseArtplayerOptions, parseDplayerOptions } from './query.js'

const PlayerQuerySchema = z.object({
  url: z.string().optional(),
  type: z.string().optional(),
  cover: z.string().optional(),
  poster: z.string().optional(),
  id: z.string().optional(),
  live: z.string().optional(),
  islive: z.string().optional(),
  muted: z.string().optional(),
  autoplay: z.string().optional(),
  autoplayback: z.string().optional(),
  hideplay: z.string().optional(),
  automini: z.string().optional(),
  loop: z.string().optional(),
  flip: z.string().optional(),
  playbackrate: z.string().optional(),
  aspectratio: z.string().optional(),
  setting: z.string().optional(),
  hotkey: z.string().optional(),
  pip: z.string().optional(),
  mutex: z.string().optional(),
  fullscreen: z.string().optional(),
  fullscreenweb: z.string().optional(),
  miniprogressbar: z.string().optional(),
  playsinline: z.string().optional(),
  lang: z.string().optional(),
  volume: z.string().optional(),
  theme: z.string().optional()
})

function playerRoute(path: '/v1/player' | '/v1/player/art', operationId: string) {
  return createRoute({
    method: 'get',
    path,
    operationId,
    tags: ['Player'],
    security: [{ serviceToken: [] }],
    request: { query: PlayerQuerySchema },
    responses: {
      200: {
        content: { 'text/html': { schema: z.string() } },
        description: 'Standalone player HTML'
      },
      400: {
        content: { 'application/json': { schema: ApiErrorResponseSchema } },
        description: 'Invalid media URL'
      }
    }
  })
}

const dplayerRoute = playerRoute('/v1/player', 'getDplayerHTML')
const artplayerRoute = playerRoute('/v1/player/art', 'getArtplayerHTML')
const assetRoute = createRoute({
  method: 'get',
  path: '/v1/player/assets/{asset}',
  operationId: 'getPlayerAsset',
  tags: ['Player'],
  'x-openapi-platform': { support: true },
  security: [{ serviceToken: [] }],
  request: { params: z.object({ asset: z.string().min(1).max(100) }) },
  responses: {
    200: {
      content: { 'application/javascript': { schema: z.string() } },
      description: 'Pinned browser player dependency'
    },
    404: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Asset was not found'
    }
  }
})

function htmlHeaders() {
  return {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; media-src http: https: blob:; img-src http: https: data:; connect-src http: https:;",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  }
}

export function registerPlayerRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(dplayerRoute, (c) => {
    const options = parseDplayerOptions(c.req.valid('query'))
    if (!options) {
      return respondWithFailure(c, 400, 'INVALID_PARAMETER', '视频地址无效，请传入 http/https url')
    }
    return c.html(renderDplayerHTML(options), 200, htmlHeaders())
  })

  app.openapi(artplayerRoute, (c) => {
    const options = parseArtplayerOptions(c.req.valid('query'))
    if (!options) {
      return respondWithFailure(c, 400, 'INVALID_PARAMETER', '视频地址无效，请传入 http/https url')
    }
    return c.html(renderArtplayerHTML(options), 200, htmlHeaders())
  })

  app.openapi(assetRoute, async (c) => {
    const asset = await readPlayerAsset(c.req.valid('param').asset)
    if (!asset) return respondWithFailure(c, 404, 'PLAYER_ASSET_NOT_FOUND', '播放器资源不存在')
    return c.newResponse(asset.body, 200, {
      'content-type': asset.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff'
    }) as never
  })
}
