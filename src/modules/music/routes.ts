import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import {
  getMusicLyrics,
  getMusicPicture,
  getMusicTracks,
  getMusicUrl,
  searchMusic
} from './client.js'
import { enabledMusicPlatforms } from './configuration.js'
import {
  formatMusicLyrics,
  normalizeMusicRedirectUrl,
  toPublicMusicTracks
} from './public-contract.js'
import { parseMusicRequestQuery } from './request.js'

const PublicTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  url: z.string().url(),
  pic: z.string().url(),
  lrc: z.string().url()
})

const route = createRoute({
  method: 'get',
  path: '/v1/music',
  operationId: 'getMusic',
  tags: ['Music'],
  security: [{ serviceToken: [] }],
  request: {
    query: z.object({
      server: z.string().optional(),
      type: z.string().optional(),
      id: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
      platform: z.string().optional(),
      q: z.string().optional(),
      pageSize: z.string().optional(),
      bitrate: z.string().optional(),
      size: z.string().optional()
    })
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessEnvelopeSchema(z.object({
            server: z.string(),
            type: z.string(),
            items: z.array(PublicTrackSchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().positive().optional(),
            limit: z.number().int().positive().optional()
          }))
        },
        'text/plain': { schema: z.string() }
      },
      description: 'Music data or lyrics'
    },
    302: { description: 'Redirect to an audio or picture resource' },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid request'
    },
    403: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Music platform disabled'
    },
    404: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Music data or resource not found'
    },
    502: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Music provider failed'
    }
  }
})

function publicOrigin(
  requestUrl: string,
  forwardedProto?: string,
  forwardedHost?: string
): URL {
  const fallback = new URL(requestUrl)
  const protocol = forwardedProto?.split(',')[0]?.trim().toLowerCase()
  const host = forwardedHost?.split(',')[0]?.trim()
  if (
    (protocol === 'http' || protocol === 'https')
    && host
    && !/[\s/\\]/.test(host)
  ) {
    try {
      return new URL(`${protocol}://${host}`)
    } catch {
      // Fall back to the Service request origin for direct calls.
    }
  }
  return new URL(fallback.origin)
}

export function registerMusicRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    const parsed = parseMusicRequestQuery(c.req.valid('query'))
    if (!parsed.ok) {
      return respondWithFailure(c, 400, parsed.code, parsed.message) as never
    }
    const request = parsed.data
    if (!enabledMusicPlatforms().has(request.platform)) {
      return respondWithFailure(
        c,
        403,
        'MUSIC_SERVER_DISABLED',
        `音乐平台 ${request.platform} 已被管理员关闭`
      ) as never
    }

    try {
      if (request.operation === 'url' || request.operation === 'pic') {
        const resource = request.operation === 'url'
          ? await getMusicUrl(request.platform, request.id, c.get('deadlineSignal'))
          : await getMusicPicture(request.platform, request.id, c.get('deadlineSignal'))
        const target = normalizeMusicRedirectUrl(request.platform, resource.url)
        if (!target) {
          const message = request.operation === 'url' && request.platform === 'tencent'
            ? '未获取到 QQ 音乐播放地址，歌曲可能需要登录、会员权限或受版权限制'
            : '未找到可用的音乐资源'
          return respondWithFailure(
            c,
            404,
            'MUSIC_RESOURCE_NOT_FOUND',
            message
          ) as never
        }
        c.header('cache-control', 'no-store')
        return c.redirect(target, 302) as never
      }

      if (request.operation === 'lrc') {
        const lyrics = await getMusicLyrics(
          request.platform,
          request.id,
          c.get('deadlineSignal')
        )
        const content = formatMusicLyrics(lyrics)
        if (!content.trim()) {
          return respondWithFailure(
            c,
            404,
            'MUSIC_LYRICS_NOT_FOUND',
            '未找到可用的歌词'
          ) as never
        }
        return c.text(content, 200, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8'
        }) as never
      }

      const tracks = request.operation === 'search'
        ? await searchMusic({
            keyword: request.id,
            platform: request.platform,
            page: request.page,
            limit: request.limit
          }, c.get('deadlineSignal'))
        : await getMusicTracks(
            request.platform,
            request.operation,
            request.id,
            request.limit,
            c.get('deadlineSignal')
          )
      if (request.operation !== 'search' && tracks.length === 0) {
        return respondWithFailure(
          c,
          404,
          'MUSIC_DATA_NOT_FOUND',
          '未找到对应的音乐数据'
        ) as never
      }
      const items = toPublicMusicTracks(
        tracks,
        publicOrigin(
          c.req.url,
          c.req.header('x-forwarded-proto'),
          c.req.header('x-forwarded-host')
        )
      )
      return respondWithSuccess(c, {
        server: request.platform,
        type: request.operation,
        items,
        total: items.length,
        ...(request.operation === 'search'
          ? { page: request.page, limit: request.limit }
          : {})
      }, '获取音乐数据成功')
    } catch (error) {
      if (c.get('deadlineSignal').aborted) {
        throw c.get('deadlineSignal').reason
      }
      return respondWithFailure(
        c,
        502,
        'UPSTREAM_ERROR',
        error instanceof Error ? error.message : '音乐服务调用失败'
      ) as never
    }
  })
}
