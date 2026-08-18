import { isIP } from 'node:net'
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import { respondWithFailure, respondWithSuccess } from '../../shared/response.js'
import {
  ApiErrorResponseSchema,
  createSuccessEnvelopeSchema
} from '../../shared/openapi.js'
import type { AppEnv } from '../../http/types.js'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import { IpLookupError, lookupIpLocation } from './service.js'

export interface IpDatabaseConfig {
  directory: string
  configuration: ServiceConfigurationManager
}

const IpLocationSchema = z.object({
  ip: z.string(),
  ip_version: z.enum(['ipv4', 'ipv6']),
  country_name: z.string().nullable(),
  region_name: z.string().nullable(),
  city_name: z.string().nullable(),
  district_name: z.string().nullable(),
  internet_service_provider: z.string().nullable(),
  database_version: z.number().int().nonnegative()
})
const IpSuccessEnvelopeSchema = createSuccessEnvelopeSchema(IpLocationSchema)
const ipRoute = createRoute({
  method: 'get',
  path: '/v1/ip',
  operationId: 'lookupIpLocation',
  tags: ['IP'],
  security: [{ serviceToken: [] }],
  request: { query: z.object({ ip: z.string().optional() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: IpSuccessEnvelopeSchema } },
      description: 'IP location data'
    },
    400: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'IP is missing or invalid'
    },
    404: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'IP was not found'
    },
    503: {
      content: { 'application/json': { schema: ApiErrorResponseSchema } },
      description: 'CZDB is not configured or unavailable'
    }
  }
})

function forwardedClientIP(value: string | undefined): string {
  return value?.split(',')[0]?.trim() ?? ''
}

export function registerIpRoutes(
  app: OpenAPIHono<AppEnv>,
  database: IpDatabaseConfig
) {
  app.openapi(ipRoute, async (c) => {
    c.header('cache-control', 'no-store')
    if (!database.configuration.getValue<boolean>('ip.enabled')) {
      return respondWithFailure(c, 503, 'IP_DISABLED', 'IP 归属地查询能力已停用')
    }
    const explicitIP = c.req.valid('query').ip?.trim() ?? ''
    const ip = explicitIP || forwardedClientIP(c.req.header('x-forwarded-for'))
    if (!ip) {
      return respondWithFailure(c, 400, 'IP_REQUIRED', '请提供 ip 参数，或检查客户端 IP 来源配置')
    }
    if (isIP(ip) === 0) {
      return respondWithFailure(c, 400, 'INVALID_IP', 'ip 必须是有效的 IPv4 或 IPv6 地址')
    }

    try {
      const data = await lookupIpLocation(
        ip,
        database.configuration.getValue<string>('ip.databaseKey'),
        database.directory
      )
      if (!data) return respondWithFailure(c, 404, 'IP_NOT_FOUND', '未找到该 IP 的归属地信息')
      return respondWithSuccess(c, data)
    } catch (error) {
      if (error instanceof IpLookupError) {
        const message = error.code === 'IP_DATABASE_NOT_CONFIGURED'
          ? 'IP 数据库尚未配置'
          : 'IP 数据库暂时不可用'
        return respondWithFailure(c, 503, error.code, message)
      }
      throw error
    }
  })
}
