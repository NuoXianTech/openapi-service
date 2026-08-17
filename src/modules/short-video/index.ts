import { isHostnameWithin } from '../../shared/safe-fetch.js'
import { parseBilibili } from './platforms/bilibili.js'
import { parseDouyin } from './platforms/douyin.js'
import { parseKuaishou } from './platforms/kuaishou.js'
import { parsePipigx } from './platforms/pipigx.js'
import { parsePipixia } from './platforms/pipixia.js'
import { parseToutiao } from './platforms/toutiao.js'
import { parseWeibo } from './platforms/weibo.js'
import { parseXiaohongshu } from './platforms/xiaohongshu.js'
import { normalizeShortVideoPayload } from './normalize.js'
import { createShortVideoError, type ShortVideoData, type ShortVideoPlatform } from './types.js'

const MAX_INPUT_LENGTH = 4_096
const SHARE_URL_PATTERN = /https?:\/\/[^\s<>"'`，。！？；：、（）【】《》「」『』]+/iu
const TRAILING_SHARE_PUNCTUATION = /[),.;!?，。！？；：、）】》」』]+$/u

const PLATFORM_HOSTS: Record<ShortVideoPlatform, readonly string[]> = {
  douyin: ['douyin.com', 'iesdouyin.com'],
  kuaishou: ['kuaishou.com', 'gifshow.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com', 'xhs.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
  weibo: ['weibo.com', 'weibo.cn', 't.cn'],
  pipixia: ['pipix.com', 'pipixia.com'],
  pipigx: ['ippzone.com', 'pipigx.com'],
  toutiao: ['toutiao.com', 'ixigua.com']
}
const PLATFORM_PARSERS: Record<
  ShortVideoPlatform,
  (sourceUrl: URL, signal?: AbortSignal) => Promise<unknown>
> = {
  bilibili: parseBilibili,
  douyin: parseDouyin,
  kuaishou: parseKuaishou,
  pipigx: parsePipigx,
  pipixia: parsePipixia,
  toutiao: parseToutiao,
  weibo: parseWeibo,
  xiaohongshu: parseXiaohongshu
}

export { normalizeShortVideoPayload } from './normalize.js'

export function parseShortVideoUrl(input: string): URL {
  const text = input.trim()
  if (!text) {
    throw createShortVideoError('input', 400, 'MISSING_PARAMETER', '缺少参数 url')
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw createShortVideoError('input', 400, 'INVALID_PARAMETER', `url 不能超过 ${MAX_INPUT_LENGTH} 个字符`)
  }

  const candidate = text.match(SHARE_URL_PATTERN)?.[0]?.replace(TRAILING_SHARE_PUNCTUATION, '')
  if (!candidate) {
    throw createShortVideoError('input', 400, 'INVALID_PARAMETER', 'url 必须包含合法的 HTTP 或 HTTPS 链接')
  }

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
      throw new Error('unsafe URL')
    }
    return url
  } catch {
    throw createShortVideoError('input', 400, 'INVALID_PARAMETER', 'url 必须包含合法的 HTTP 或 HTTPS 链接')
  }
}

export function detectShortVideoPlatform(url: URL): ShortVideoPlatform {
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS) as Array<[
    ShortVideoPlatform,
    readonly string[]
  ]>) {
    if (hosts.some(host => isHostnameWithin(url.hostname, host))) return platform
  }

  throw createShortVideoError('input', 422, 'UNSUPPORTED_PLATFORM', '暂不支持该短视频平台')
}

export async function parseShortVideo(sourceUrl: URL, platform: ShortVideoPlatform, signal?: AbortSignal): Promise<ShortVideoData> {
  const payload = await PLATFORM_PARSERS[platform](sourceUrl, signal)
  return normalizeShortVideoPayload(payload, platform)
}
