import { isHostnameWithin } from '../../shared/safe-fetch.js'
import { AiMediaError, type AiMediaPlatform } from './types.js'

export const AI_MEDIA_HOSTS: Record<AiMediaPlatform, readonly string[]> = {
  doubao: ['doubao.com'],
  jimeng: ['jimeng.jianying.com', 'v.jimeng.aiseet.atry.com', 'jimeng.ai'],
  xiaoyunque: ['xiaoyunque.jianying.com', 'xyq.jianying.com'],
  kling: ['klingai-share.kuaishou.com'],
  hailuo: ['hailuoai.com', 'hailuoai.video'],
  qianwen: ['qianwen.com', 'qianwen.aliyun.com', 'tongyi.aliyun.com', 'qianwen.my.cn', 'tongyi.com']
}

export function parseAiMediaUrl(input: string): URL {
  const value = input.trim()
  if (!value) throw new AiMediaError(400, 'MISSING_PARAMETER', '缺少参数 url')
  if (value.length > 4_096) {
    throw new AiMediaError(400, 'INVALID_PARAMETER', 'url 不能超过 4096 个字符')
  }
  const match = value.match(/https?:\/\/[^\s<>"'`，。！？；：、（）【】《》「」『』]+/iu)
  try {
    const url = new URL((match?.[0] ?? '').replace(/[),.;!?，。！？；：、）】》」』]+$/u, ''))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
      throw new Error('invalid URL')
    }
    url.protocol = 'https:'
    url.hash = ''
    return url
  } catch {
    throw new AiMediaError(400, 'INVALID_PARAMETER', 'url 必须包含合法的 HTTP 或 HTTPS 分享链接')
  }
}

export function detectAiMediaPlatform(url: URL): AiMediaPlatform {
  for (const platform of Object.keys(AI_MEDIA_HOSTS) as AiMediaPlatform[]) {
    if (AI_MEDIA_HOSTS[platform].some(host => isHostnameWithin(url.hostname, host))) return platform
  }
  throw new AiMediaError(422, 'UNSUPPORTED_PLATFORM', '暂不支持该 AI 创作平台')
}
