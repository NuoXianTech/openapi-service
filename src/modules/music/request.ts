import { isMusicPlatform } from './client.js'
import { MUSIC_OPERATIONS, type MusicOperation, type MusicPlatform } from './types.js'

const REMOVED_QUERY_PARAMETERS = ['platform', 'q', 'pageSize', 'bitrate', 'size'] as const

interface MusicRequest {
  platform: MusicPlatform
  operation: MusicOperation
  id: string
  page: number
  limit: number
}

export type MusicRequestParseResult
  = { ok: true, data: MusicRequest }
    | { ok: false, code: string, message: string }

function readBoundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number | null {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function isMusicOperation(value: string): value is MusicOperation {
  return MUSIC_OPERATIONS.some(operation => operation === value)
}

export function parseMusicRequestQuery(query: Record<string, unknown>): MusicRequestParseResult {
  const removedParameter = REMOVED_QUERY_PARAMETERS.find(parameter => query[parameter] !== undefined)
  if (removedParameter) {
    return {
      ok: false,
      code: 'UNSUPPORTED_PARAMETER',
      message: `参数 ${removedParameter} 已移除，请使用 server、type、id、page、limit`
    }
  }

  const read = (value: unknown) => typeof value === 'string' ? value : ''
  const platformValue = read(query.server).trim().toLowerCase() || 'netease'
  if (!isMusicPlatform(platformValue)) {
    return { ok: false, code: 'INVALID_SERVER', message: 'server 参数不受支持' }
  }

  const operationValue = read(query.type).trim().toLowerCase() || 'search'
  if (!isMusicOperation(operationValue)) {
    return { ok: false, code: 'INVALID_TYPE', message: 'type 参数不受支持' }
  }

  const id = read(query.id).trim()
  if (!id) {
    return { ok: false, code: 'MISSING_PARAMETER', message: 'id 参数不能为空' }
  }

  if (operationValue !== 'search' && query.page !== undefined) {
    return { ok: false, code: 'UNSUPPORTED_PARAMETER', message: 'page 仅用于 search 类型' }
  }
  if (operationValue !== 'search' && operationValue !== 'artist' && query.limit !== undefined) {
    return { ok: false, code: 'UNSUPPORTED_PARAMETER', message: 'limit 仅用于 search 或 artist 类型' }
  }

  const page = readBoundedInteger(query.page, 1, 1, 1000)
  const limit = readBoundedInteger(query.limit, operationValue === 'artist' ? 50 : 30, 1, 100)
  if (page === null || limit === null) {
    return { ok: false, code: 'INVALID_PARAMETER', message: 'page 或 limit 参数超出有效范围' }
  }

  return {
    ok: true,
    data: {
      platform: platformValue,
      operation: operationValue,
      id,
      page,
      limit
    }
  }
}
