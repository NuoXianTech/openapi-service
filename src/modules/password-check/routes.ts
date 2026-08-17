import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { createBodyLimitMiddleware } from '../../http/middleware/request-limits.js'
import { ApiErrorResponseSchema, createSuccessEnvelopeSchema } from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import {
  checkPasswordStrength,
  formatPasswordCheckMarkdown,
  formatPasswordCheckText,
  parsePasswordCheckBody
} from './service.js'

const CharacterAnalysisSchema = z.object({
  has_lowercase: z.boolean(), has_uppercase: z.boolean(),
  has_numbers: z.boolean(), has_symbols: z.boolean(),
  has_other_letters: z.boolean(), has_repeated: z.boolean(),
  has_sequential: z.boolean(), is_common_password: z.boolean(),
  character_variety: z.number().int(), unique_characters: z.number().int()
})
const ResultSchema = z.object({
  length: z.number().int(), score: z.number().int(),
  strength: z.enum(['极弱', '弱', '中等', '强', '极强']),
  entropy: z.number(), time_to_crack: z.string(),
  character_analysis: CharacterAnalysisSchema,
  recommendations: z.array(z.string()), security_tips: z.array(z.string())
})
const route = createRoute({
  method: 'post', path: '/v1/password/check',
  operationId: 'checkPasswordStrength', tags: ['Password'],
  security: [{ serviceToken: [] }],
  request: {
    query: z.object({
      encode: z.string().optional(), encoding: z.string().optional()
    }),
    body: {
      required: true,
      content: { 'application/json': { schema: z.unknown() } }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': { schema: createSuccessEnvelopeSchema(ResultSchema) },
        'text/plain': { schema: z.string() },
        'text/markdown': { schema: z.string() }
      },
      description: 'Password strength analysis'
    },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid password or encoding'
    }
  }
})

export function registerPasswordCheckRoutes(app: OpenAPIHono<AppEnv>) {
  app.use('/v1/password/check', createBodyLimitMiddleware(32 * 1024))
  app.openapi(route, (c) => {
    c.header('cache-control', 'no-store')
    c.header('pragma', 'no-cache')
    const query = c.req.valid('query')
    const encoding = (query.encode ?? query.encoding ?? 'json').toLowerCase()
    if (!['json', 'text', 'markdown', 'md'].includes(encoding)) {
      return respondWithFailure(
        c, 400, 'INVALID_ENCODING',
        'encode 必须是 json、text、markdown 或 md'
      ) as never
    }
    const parsed = parsePasswordCheckBody(c.req.valid('json'))
    if (!parsed.ok) {
      return respondWithFailure(c, 400, parsed.code, parsed.message) as never
    }
    const result = checkPasswordStrength(parsed.password)
    if (encoding === 'text') return c.text(formatPasswordCheckText(result)) as never
    if (encoding === 'markdown' || encoding === 'md') {
      c.header('content-type', 'text/markdown; charset=UTF-8')
      return c.body(formatPasswordCheckMarkdown(result)) as never
    }
    return respondWithSuccess(c, result, '密码强度检测成功')
  })
}
