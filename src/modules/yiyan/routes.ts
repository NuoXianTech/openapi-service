import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createSuccessResponse,
  respondWithFailure,
  respondWithSuccess
} from '../../shared/response.js'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import type { AppEnv } from '../../http/types.js'
import {
  encodeYiyanBody,
  formatYiyanJavaScript,
  formatYiyanMarkdown,
  formatYiyanText,
  isValidJsonpCallback,
  toRecord,
  yiyanContentType
} from './format.js'
import { pickSentence } from './repository.js'
import {
  DEFAULT_MAX_LENGTH,
  DEFAULT_MIN_LENGTH,
  DEFAULT_YIYAN_CHARSET,
  DEFAULT_YIYAN_ENCODE,
  DEFAULT_YIYAN_SELECT,
  DEFAULT_YIYAN_TYPE,
  isYiyanEncode,
  isYiyanType,
  type YiyanCharset,
  type YiyanEncode,
  type YiyanType
} from './types.js'

const YiyanQuerySchema = z.object({
  type: z.string().optional(),
  encode: z.string().optional(),
  charset: z.string().optional(),
  callback: z.string().optional(),
  select: z.string().optional(),
  min_length: z.string().optional(),
  max_length: z.string().optional(),
  id: z.string().optional()
})

const YiyanRecordSchema = z.object({
  id: z.string(),
  yiyan: z.string(),
  type: z.string(),
  from: z.string().nullable(),
  from_who: z.string().nullable(),
  created_at: z.string(),
  length: z.number().int().nonnegative()
})

const YiyanSuccessEnvelopeSchema = createSuccessEnvelopeSchema(YiyanRecordSchema)

const yiyanRoute = createRoute({
  method: 'get',
  path: '/v1/yiyan',
  operationId: 'getYiyan',
  tags: ['Yiyan'],
  security: [{ serviceToken: [] }],
  request: { query: YiyanQuerySchema },
  responses: {
    200: {
      content: {
        'application/json': { schema: YiyanSuccessEnvelopeSchema },
        'text/plain': { schema: z.string() },
        'text/markdown': { schema: z.string() },
        'application/javascript': { schema: z.string() }
      },
      description: 'A sentence in the requested representation'
    },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid parameters'
    },
    404: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'No matching sentence'
    }
  }
})

function parseLength(value: string | undefined, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

export function registerYiyanRoutes(app: OpenAPIHono<AppEnv>) {
  app.openapi(yiyanRoute, async (c) => {
    const query = c.req.valid('query')
    const typeValue = query.type?.trim().toLowerCase() ?? ''
    const type: YiyanType = isYiyanType(typeValue)
      ? typeValue
      : DEFAULT_YIYAN_TYPE
    const encodeValue = query.encode?.trim().toLowerCase() ?? ''
    const encode: YiyanEncode = isYiyanEncode(encodeValue)
      ? encodeValue
      : DEFAULT_YIYAN_ENCODE
    const charset: YiyanCharset = query.charset?.trim().toLowerCase() === 'gbk'
      ? 'gbk'
      : DEFAULT_YIYAN_CHARSET
    const callback = query.callback?.trim() ?? ''
    const selector = query.select?.trim() || DEFAULT_YIYAN_SELECT
    const minLength = parseLength(query.min_length, DEFAULT_MIN_LENGTH)
    const maxLength = parseLength(
      query.max_length,
      type === 'i' ? Number.MAX_SAFE_INTEGER : DEFAULT_MAX_LENGTH
    )

    if (minLength > maxLength) {
      return respondWithFailure(
        c,
        400,
        'INVALID_PARAMETER',
        `min_length(${minLength}) 不能大于 max_length(${maxLength})`
      )
    }
    if (callback && !isValidJsonpCallback(callback)) {
      return respondWithFailure(c, 400, 'INVALID_PARAMETER', 'callback 必须是合法的 JS 函数名')
    }
    if (callback && charset === 'gbk') {
      return respondWithFailure(
        c,
        400,
        'INVALID_PARAMETER',
        'charset=gbk 不支持与 callback（异步函数）同用'
      )
    }

    const sentence = await pickSentence({
      type,
      minLength,
      maxLength,
      id: query.id?.trim() || null
    })
    if (!sentence) {
      return respondWithFailure(
        c,
        404,
        'YIYAN_NOT_FOUND',
        query.id ? '未找到一言' : '暂无符合条件的一言'
      )
    }

    c.header('cache-control', 'no-store')
    const record = toRecord(sentence, type)
    if (callback || encode === 'json') {
      const envelope = createSuccessResponse(record)
      if (!callback && charset === 'utf-8') return respondWithSuccess(c, record)
      const text = callback
        ? `${callback}(${JSON.stringify(envelope)})`
        : JSON.stringify(envelope)
      return c.newResponse(encodeYiyanBody(text, charset), 200, {
        'content-type': yiyanContentType(callback ? 'jsonp' : 'json', charset)
      }) as never
    }

    const body = encode === 'text'
      ? formatYiyanText(record)
      : encode === 'js'
        ? formatYiyanJavaScript(record, selector)
        : formatYiyanMarkdown(record)
    return c.newResponse(encodeYiyanBody(body, charset), 200, {
      'content-type': yiyanContentType(encode, charset)
    }) as never
  })
}
