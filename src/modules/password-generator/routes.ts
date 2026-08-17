import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import {
  formatPasswordGeneratorMarkdown,
  generatePassword,
  parsePasswordGeneratorMode,
  parsePasswordLength
} from './service.js'

const route = createRoute({
  method: 'get', path: '/v1/password', operationId: 'generatePassword',
  tags: ['Password'], security: [{ serviceToken: [] }],
  request: { query: z.object({
    length: z.string().optional(), mode: z.string().optional(),
    encode: z.string().optional(), encoding: z.string().optional()
  }) },
  responses: {
    200: { content: {
      'application/json': { schema: createSuccessEnvelopeSchema(z.object({
        password: z.string(), length: z.number().int(),
        mode: z.enum(['strong', 'alphanumeric', 'numeric']),
        character_types: z.array(z.string()), entropy: z.number(),
        strength: z.enum(['弱', '中等', '强', '极强']),
        ambiguous_characters_excluded: z.literal(true)
      })) },
      'text/plain': { schema: z.string() },
      'text/markdown': { schema: z.string() }
    }, description: 'Cryptographically secure random password' },
    400: { content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid generator options' }
  }
})

export function registerPasswordGeneratorRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(route, (c) => {
    c.header('cache-control', 'no-store')
    c.header('pragma', 'no-cache')
    const query = c.req.valid('query')
    const length = parsePasswordLength((query.length ?? '').trim())
    if (length === null) {
      return respondWithFailure(
        c, 400, 'INVALID_LENGTH', 'length 必须是 4-128 之间的整数'
      ) as never
    }
    const mode = parsePasswordGeneratorMode((query.mode ?? '').trim())
    if (mode === null) {
      return respondWithFailure(
        c, 400, 'INVALID_MODE',
        'mode 仅支持 strong、alphanumeric 或 numeric'
      ) as never
    }
    const encoding = (query.encode ?? query.encoding ?? 'json').toLowerCase()
    if (!['json', 'text', 'markdown', 'md'].includes(encoding)) {
      return respondWithFailure(
        c, 400, 'INVALID_ENCODING',
        'encode 必须是 json、text、markdown 或 md'
      ) as never
    }
    const result = generatePassword({ length, mode })
    if (encoding === 'text') return c.text(result.password) as never
    if (encoding === 'markdown' || encoding === 'md') {
      c.header('content-type', 'text/markdown; charset=UTF-8')
      return c.body(formatPasswordGeneratorMarkdown(result)) as never
    }
    return respondWithSuccess(c, result, '随机密码生成成功')
  })
}
