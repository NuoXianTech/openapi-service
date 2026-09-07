import type { z } from '@hono/zod-openapi'
import type { AiMediaDataSchema } from './schema.js'

export const AI_MEDIA_PLATFORMS = [
  'doubao', 'jimeng', 'xiaoyunque', 'kling', 'hailuo', 'qianwen'
] as const

export type AiMediaPlatform = typeof AI_MEDIA_PLATFORMS[number]

export const AI_MEDIA_LABELS: Record<AiMediaPlatform, string> = {
  doubao: '豆包', jimeng: '即梦', xiaoyunque: '小云雀',
  kling: '可灵', hailuo: '海螺', qianwen: '通义千问'
}

export interface AiMediaRequestOptions {
  cookie?: string | undefined
  signal?: AbortSignal | undefined
}

export type AiMediaData = z.infer<typeof AiMediaDataSchema>
export type AiMediaItem = AiMediaData['media'][number]

export class AiMediaError extends Error {
  override readonly name = 'AiMediaError'

  constructor(
    readonly status: 400 | 403 | 422 | 502 | 503,
    readonly code: string,
    message: string,
    readonly retryAfter?: number
  ) {
    super(message)
  }
}

export function parseFailed(): AiMediaError {
  return new AiMediaError(422, 'PARSE_FAILED', '分享内容不存在、已经失效或未包含可解析的媒体')
}
