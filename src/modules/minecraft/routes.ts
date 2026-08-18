import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../http/types.js'
import {
  classifyMinecraftError,
  createMinecraftInputError,
  getMinecraftProfile,
  normalizeMinecraftIdentifier,
  parseMinecraftOutputType
} from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/minecraft', operationId: 'getMinecraftProfile',
  tags: ['Minecraft'], security: [{ serviceToken: [] }],
  request: { query: z.object({ id: z.string().optional(), type: z.string().optional() }) },
  responses: {
    200: { content: { 'application/json': { schema: createSuccessEnvelopeSchema(z.object({
      name: z.string(), uuid: z.string(), texture_timestamp: z.number().int(),
      skin: z.object({ url: z.string().url(), model: z.enum(['classic', 'slim']) }).nullable(),
      cape: z.object({ url: z.string().url() }).nullable()
    })) } }, description: 'Minecraft Java profile' },
    302: { description: 'Redirect to official skin or cape texture' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Invalid input' },
    404: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Player or texture not found' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Mojang unavailable' }
  }
})

export function registerMinecraftRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    const query = c.req.valid('query')
    const raw = query.id ?? ''
    const identifier = normalizeMinecraftIdentifier(raw)
    const type = parseMinecraftOutputType(query.type ?? '')
    try {
      if (!raw.trim()) throw createMinecraftInputError('MISSING_ID')
      if (!identifier) throw createMinecraftInputError('INVALID_ID')
      if (!type) throw createMinecraftInputError('INVALID_TYPE')
      const data = await getMinecraftProfile(identifier, c.get('deadlineSignal'))
      const cacheControl = 'public, max-age=300'
      c.header('cache-control', cacheControl)
      if (type === 'skin') {
        if (!data.skin) return respondWithFailure(c, 404, 'SKIN_NOT_FOUND', '该玩家没有可用的皮肤纹理') as never
        return c.redirect(data.skin.url, 302) as never
      }
      if (type === 'cape') {
        if (!data.cape) return respondWithFailure(c, 404, 'CAPE_NOT_FOUND', '该玩家没有可用的披风纹理') as never
        return c.redirect(data.cape.url, 302) as never
      }
      return respondWithSuccess(c, data, '获取 Minecraft 玩家资料成功', cacheControl)
    } catch (error) {
      if (c.get('deadlineSignal').aborted) throw c.get('deadlineSignal').reason
      const result = classifyMinecraftError(error)
      return respondWithFailure(c, result.status, result.code, result.message) as never
    }
  })
}
