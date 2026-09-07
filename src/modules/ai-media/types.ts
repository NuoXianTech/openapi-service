export const AI_MEDIA_PLATFORMS = [
  'doubao', 'jimeng', 'xiaoyunque', 'kling', 'hailuo', 'qianwen'
] as const

export type AiMediaPlatform = typeof AI_MEDIA_PLATFORMS[number]

export const AI_MEDIA_LABELS: Record<AiMediaPlatform, string> = {
  doubao: '豆包', jimeng: '即梦AI', xiaoyunque: '小云雀AI',
  kling: '可灵AI', hailuo: '海螺AI', qianwen: '通义千问'
}

export interface AiMediaRequestOptions {
  cookie?: string | undefined
  signal?: AbortSignal | undefined
}

export interface AiMediaItem {
  type: 'image' | 'video'
  url: string
  source: 'original' | 'download' | 'preview'
  /** Inferred from the upstream field/URL; this is not pixel-level detection. */
  watermark: 'none' | 'ai-generated' | 'present' | 'unknown'
}

export interface AiMediaData {
  platform: AiMediaPlatform
  title: string
  author: { name: string, id: string, avatar: string }
  cover: string
  media: AiMediaItem[]
  warnings: string[]
}

export type AiMediaResult = Omit<AiMediaData, 'platform'>

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
