import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'
import { toPublicCryptoAlgorithm } from './catalog.js'
import { ensureCryptoAlgorithmsRegistered } from './index.js'
import {
  getCryptoAlgorithm,
  listCryptoAlgorithms,
  normalizeCryptoOptions
} from './registry.js'
import { parseCryptoRequestBody, toCryptoMode } from './request.js'
import { isCryptoBusinessError } from './types.js'

const AlgorithmSchema = z.object({
  algorithm: z.string(),
  name: z.string(),
  description: z.string(),
  keyRequired: z.boolean(),
  example: z.object({
    algorithm: z.string(),
    action: z.literal('encode'),
    input: z.string(),
    key: z.string().optional()
  })
})
const getRoute = createRoute({
  method: 'get',
  path: '/v1/crypto',
  operationId: 'listCryptoAlgorithms',
  tags: ['Crypto'],
  security: [{ serviceToken: [] }],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessEnvelopeSchema(z.object({
            items: z.array(AlgorithmSchema)
          }))
        }
      },
      description: 'Enabled crypto algorithms'
    }
  }
})
const postRoute = createRoute({
  method: 'post',
  path: '/v1/crypto',
  operationId: 'executeCryptoAlgorithm',
  tags: ['Crypto'],
  security: [{ serviceToken: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: z.unknown() }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessEnvelopeSchema(z.object({ result: z.string() }))
        }
      },
      description: 'Processed result'
    },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Invalid request body'
    },
    403: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Algorithm disabled'
    },
    404: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Algorithm not found'
    },
    422: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'Algorithm rejected the input'
    }
  }
})

function enabledAlgorithms(
  configuration: ServiceConfigurationManager
): Set<string> {
  return new Set(configuration.getValue<string[]>('crypto.allowedAlgorithms'))
}

export function registerCryptoRoutes(
  app: OpenAPIHono<AppEnv>,
  configuration: ServiceConfigurationManager
) {
  ensureCryptoAlgorithmsRegistered()
  app.openapi(getRoute, (c) => {
    const enabled = enabledAlgorithms(configuration)
    return respondWithSuccess(c, {
      items: listCryptoAlgorithms()
        .filter(algorithm => enabled.has(algorithm.name))
        .map(toPublicCryptoAlgorithm)
    }, '获取算法列表成功')
  })

  app.openapi(postRoute, async (c) => {
    const parsed = parseCryptoRequestBody(c.req.valid('json'))
    if (!parsed.ok) {
      return respondWithFailure(
        c,
        400,
        parsed.code,
        parsed.message
      ) as never
    }
    const request = parsed.data
    const algorithm = getCryptoAlgorithm(request.algorithm)
    if (!algorithm) {
      return respondWithFailure(
        c,
        404,
        'ALGORITHM_NOT_FOUND',
        `未知算法 "${request.algorithm}"，请通过 GET /v1/crypto 查看可用列表`
      ) as never
    }
    if (!enabledAlgorithms(configuration).has(algorithm.name)) {
      return respondWithFailure(
        c,
        403,
        'CRYPTO_ALGORITHM_DISABLED',
        `算法 "${algorithm.name}" 已被管理员关闭`
      ) as never
    }
    const mode = toCryptoMode(request.action)
    if (!algorithm.modes.includes(mode)) {
      return respondWithFailure(
        c,
        422,
        'UNSUPPORTED_ACTION',
        `算法 "${algorithm.name}" 不支持 ${request.action} 操作`
      ) as never
    }
    try {
      const options = normalizeCryptoOptions(
        algorithm.options,
        mode,
        {
          ...request.options,
          ...(request.key !== undefined ? { key: request.key } : {})
        }
      )
      const result = await algorithm.exec({
        mode,
        text: request.input,
        options
      })
      return respondWithSuccess(c, { result: result.text }, '处理成功')
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败'
      return respondWithFailure(
        c,
        422,
        isCryptoBusinessError(error) ? error.bizCode : 'CRYPTO_FAILED',
        message
      ) as never
    }
  })
}
