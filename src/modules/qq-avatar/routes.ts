import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import {
  createQqAvatarData,
  normalizeQqNumber,
  parseQqAvatarOutputType,
  parseQqAvatarSize
} from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/qq-avatar', operationId: 'getQqAvatar',
  tags: ['QQ'], security: [{ serviceToken: [] }],
  request: { query: z.object({
    qq: z.string().optional(), size: z.string().optional(),
    type: z.string().optional()
  }) },
  responses: {
    200: { content: { 'application/json': {
      schema: createSuccessEnvelopeSchema(z.object({
        qq: z.string(), size: z.union([
          z.literal(40), z.literal(100), z.literal(140), z.literal(640)
        ]), url: z.string().url()
      }))
    } }, description: 'QQ avatar information' },
    302: { description: 'Redirect to the Tencent avatar image' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid QQ avatar request' }
  }
})

export function registerQqAvatarRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, (c) => {
    const query = c.req.valid('query')
    if (!(query.qq ?? '').trim()) {
      return respondWithFailure(c, 400, 'MISSING_QQ', '缺少参数 qq') as never
    }
    const qq = normalizeQqNumber(query.qq ?? '')
    if (!qq) {
      return respondWithFailure(
        c, 400, 'INVALID_QQ', 'qq 必须是 5-12 位且不以 0 开头的数字'
      ) as never
    }
    const size = parseQqAvatarSize(query.size ?? '')
    if (!size) {
      return respondWithFailure(
        c, 400, 'INVALID_SIZE', 'size 仅支持 40、100、140 或 640'
      ) as never
    }
    const type = parseQqAvatarOutputType(query.type ?? '')
    if (!type) {
      return respondWithFailure(
        c, 400, 'INVALID_TYPE', 'type 仅支持 json 或 image'
      ) as never
    }
    const data = createQqAvatarData(qq, size)
    c.header('access-control-allow-origin', '*')
    c.header('cache-control', 'public, max-age=86400')
    if (type === 'image') return c.redirect(data.url, 302) as never
    return respondWithSuccess(
      c, data, '获取 QQ 头像信息成功', 'public, max-age=86400'
    )
  })
}
