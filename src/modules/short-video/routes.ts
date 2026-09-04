import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { AppEnv } from '../../http/types.js'
import {
  detectShortVideoPlatform,
  parseShortVideo,
  parseShortVideoUrl
} from './index.js'
import {
  classifyShortVideoError,
  SHORT_VIDEO_PLATFORMS
} from './types.js'

const MediaUrlSchema = z.string().url().or(z.literal(''))
const DataSchema = z.object({
  platform: z.enum(SHORT_VIDEO_PLATFORMS),
  type: z.enum(['video', 'image', 'live', 'unknown']),
  author: z.string(), uid: z.string(), avatar: MediaUrlSchema,
  like: z.number().nullable(), time: z.number().nullable(),
  title: z.string(), cover: MediaUrlSchema, url: MediaUrlSchema,
  images: z.array(z.string().url()),
  livePhotos: z.array(z.object({
    image: z.string().url(), video: z.string().url()
  })),
  music: z.object({
    title: z.string(), author: z.string(),
    url: MediaUrlSchema, avatar: MediaUrlSchema
  }).nullable()
})
const route = createRoute({
  method: 'get', path: '/v1/short-video', operationId: 'parseShortVideo',
  tags: ['Short Video'], security: [{ serviceToken: [] }],
  request: { query: z.object({ url: z.string().optional() }) },
  responses: {
    200: { content: { 'application/json': {
      schema: createSuccessEnvelopeSchema(DataSchema)
    } }, description: 'Normalized short-video data' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid share URL' },
    403: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Platform disabled by the administrator' },
    422: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Unsupported platform or content could not be parsed' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Platform request failed' },
    503: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Platform is temporarily busy' }
  }
})

export function registerShortVideoRoutes(
  app: OpenAPIHono<AppEnv>,
  configuration: ServiceConfigurationManager
) {
  app.openapi(route, async (c) => {
    c.header('cache-control', 'no-store')
    try {
      const source = parseShortVideoUrl(c.req.valid('query').url ?? '')
      const platform = detectShortVideoPlatform(source)
      const enabledPlatforms = configuration.getValue<string[]>(
        'shortVideo.enabledPlatforms'
      )
      if (!enabledPlatforms.includes(platform)) {
        return respondWithFailure(
          c,
          403,
          'SHORT_VIDEO_PLATFORM_DISABLED',
          `短视频平台 ${platform} 已被管理员关闭`
        ) as never
      }

      const data = await parseShortVideo(source, platform, {
        cookie: configuration.getValue<string>(`shortVideo.${platform}Cookie`),
        signal: c.get('deadlineSignal')
      })
      return respondWithSuccess(c, data, '短视频解析成功')
    } catch (error) {
      if (c.get('deadlineSignal').aborted) {
        throw c.get('deadlineSignal').reason
      }
      const failure = classifyShortVideoError(error)
      if (failure.retryAfter) {
        c.header('retry-after', String(failure.retryAfter))
      }
      return respondWithFailure(
        c,
        failure.status as 400 | 422 | 502 | 503,
        failure.code,
        failure.message
      ) as never
    }
  })
}
