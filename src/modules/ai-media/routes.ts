import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { AppEnv } from '../../http/types.js'
import { ApiErrorResponseSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import { detectAiMediaPlatform, parseAiMediaUrl } from './input.js'
import { parseAiMedia } from './index.js'
import { AiMediaResponseSchema } from './schema.js'
import { AiMediaError, AI_MEDIA_LABELS, AI_MEDIA_PLATFORMS, type AiMediaPlatform } from './types.js'

function createPlatformRoute(platform: AiMediaPlatform) {
  const name = platform[0]!.toUpperCase() + platform.slice(1)
  return createRoute({
    method: 'get', path: `/v1/ai-media/${platform}`, operationId: `parse${name}Media`,
    // The first business tag gives each platform its own Product in Platform.
    tags: [`${name} Media`], security: [{ serviceToken: [] }],
    description: `解析${AI_MEDIA_LABELS[platform]}分享链接，返回作品信息和媒体列表。缺失信息为 null；variant 表示媒体版本，watermark 根据上游字段判断，未做像素检测。`,
    request: { query: z.object({ url: z.string().optional().openapi({ description: '分享链接或包含链接的完整文案，最长 4096 字符' }) }) },
    responses: {
      200: { description: '媒体解析结果', content: { 'application/json': { schema: AiMediaResponseSchema } } },
      400: { description: '分享链接、参数无效或链接平台与接口不匹配', content: { 'application/json': { schema: ApiErrorResponseSchema } } },
      403: { description: '平台已被管理员关闭', content: { 'application/json': { schema: ApiErrorResponseSchema } } },
      422: { description: '平台不支持、分享失效、缺少媒体或需要登录态', content: { 'application/json': { schema: ApiErrorResponseSchema } } },
      502: { description: '上游请求失败或返回无效数据', content: { 'application/json': { schema: ApiErrorResponseSchema } } },
      503: { description: '上游服务繁忙', content: { 'application/json': { schema: ApiErrorResponseSchema } } }
    }
  })
}

export function registerAiMediaRoutes(app: OpenAPIHono<AppEnv>, configuration: ServiceConfigurationManager) {
  for (const platform of AI_MEDIA_PLATFORMS) {
    app.openapi(createPlatformRoute(platform), async c => {
      try {
        const input = c.req.valid('query').url ?? ''
        if (detectAiMediaPlatform(parseAiMediaUrl(input)) !== platform) {
          throw new AiMediaError(400, 'AI_MEDIA_PLATFORM_MISMATCH', `请提供${AI_MEDIA_LABELS[platform]}分享链接`)
        }
        if (!configuration.getValue<string[]>('aiMedia.enabledPlatforms').includes(platform)) {
          throw new AiMediaError(403, 'AI_MEDIA_PLATFORM_DISABLED', `${AI_MEDIA_LABELS[platform]}已被管理员关闭`)
        }
        const data = await parseAiMedia(input, {
          cookie: configuration.getValue<string>(`aiMedia.${platform}Cookie`),
          signal: c.get('deadlineSignal')
        })
        return respondWithSuccess(c, data, '解析成功')
      } catch (error) {
        c.get('deadlineSignal').throwIfAborted()
        const failure = error instanceof AiMediaError
          ? error
          : new AiMediaError(502, 'UPSTREAM_ERROR', 'AI 媒体解析服务暂时不可用，请稍后重试')
        if (failure.retryAfter) c.header('retry-after', String(failure.retryAfter))
        return respondWithFailure(c, failure.status, failure.code, failure.message) as never
      }
    })
  }
}
