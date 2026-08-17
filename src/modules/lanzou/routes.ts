import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import { classifyLanzouError, parseLanzouFile, parseLanzouShareUrl } from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/lanzou', operationId: 'parseLanzouShare',
  tags: ['Lanzou'], security: [{ serviceToken: [] }],
  request: { query: z.object({
    url: z.string().optional(), pwd: z.string().optional(), type: z.string().optional()
  }) },
  responses: {
    200: { content: { 'application/json': { schema: createSuccessEnvelopeSchema(
      z.object({ name: z.string(), size: z.string(), url: z.string().url() })
    ) } }, description: 'Resolved file data' },
    302: { description: 'Redirect to the temporary download URL' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Invalid input or missing password' },
    422: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Share cannot be resolved' },
    502: { content: { 'application/json': { schema: ApiErrorResponseSchema } }, description: 'Invalid upstream response' }
  }
})

export function registerLanzouRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, async (c) => {
    c.header('cache-control', 'no-store')
    const query = c.req.valid('query')
    try {
      const source = parseLanzouShareUrl(query.url ?? '')
      const data = await parseLanzouFile(
        source,
        query.pwd ?? '',
        c.get('deadlineSignal')
      )
      if (query.type?.trim().toLowerCase() === 'down') {
        return c.redirect(data.url, 302) as never
      }
      return respondWithSuccess(c, data, '蓝奏云链接解析成功')
    } catch (error) {
      if (c.get('deadlineSignal').aborted) throw c.get('deadlineSignal').reason
      const result = classifyLanzouError(error)
      return respondWithFailure(
        c, result.status, result.code, result.message
      ) as never
    }
  })
}
