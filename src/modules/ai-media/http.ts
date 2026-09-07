import { safeFetch, isHostnameWithin } from '../../shared/safe-fetch.js'
import { readLimitedText } from '../../shared/limited-response.js'
import { AI_MEDIA_HOSTS } from './input.js'
import { parseJsonPreservingIntegers } from './json.js'
import { AiMediaError, AI_MEDIA_LABELS, parseFailed } from './types.js'
import type { AiMediaPlatform, AiMediaRequestOptions } from './types.js'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
export const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

interface AiRequestOptions extends AiMediaRequestOptions {
  body?: unknown
  referer?: string
  userAgent?: string
  allowedHosts?: readonly string[]
}

async function request(
  platform: AiMediaPlatform,
  input: string | URL,
  options: AiRequestOptions
): Promise<Response> {
  options.signal?.throwIfAborted()
  const url = new URL(input)
  const headers = new Headers({
    accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': options.userAgent ?? USER_AGENT
  })
  if (options.referer) headers.set('referer', options.referer)
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    headers.set('origin', url.origin)
  }
  // Playback CDNs never receive the administrator's platform cookie.
  if (options.cookie?.trim() && AI_MEDIA_HOSTS[platform].some(host => isHostnameWithin(url.hostname, host))) {
    headers.set('cookie', options.cookie.trim())
  }
  let response: Response
  try {
    response = await safeFetch(url, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal ?? AbortSignal.timeout(15_000),
      allowedHosts: options.allowedHosts ?? AI_MEDIA_HOSTS[platform]
    })
  } catch {
    options.signal?.throwIfAborted()
    throw new AiMediaError(502, 'UPSTREAM_ERROR', `${AI_MEDIA_LABELS[platform]}平台请求失败`)
  }
  if (response.ok) return response
  await response.body?.cancel().catch(() => undefined)
  if (response.status === 429 || response.status === 503) {
    const rawRetry = response.headers.get('retry-after')
    const seconds = rawRetry && /^\d+$/.test(rawRetry)
      ? Number(rawRetry)
      : (Date.parse(rawRetry ?? '') - Date.now()) / 1_000
    throw new AiMediaError(
      503, 'UPSTREAM_BUSY', `${AI_MEDIA_LABELS[platform]}平台服务繁忙，请稍后重试`,
      Number.isFinite(seconds) && seconds > 0 ? Math.min(3_600, Math.ceil(seconds)) : undefined
    )
  }
  if (response.status === 404 || response.status === 410) throw parseFailed()
  if (response.status === 401 || response.status === 403) {
    throw new AiMediaError(422, 'AI_MEDIA_AUTH_REQUIRED', '平台拒绝访问，请检查分享权限或更新对应平台 Cookie')
  }
  throw new AiMediaError(502, 'UPSTREAM_ERROR', `${AI_MEDIA_LABELS[platform]}平台请求失败`)
}

export async function requestAiText(
  platform: AiMediaPlatform,
  input: string | URL,
  options: AiRequestOptions = {},
  maxBytes = 8 * 1024 * 1024
): Promise<string> {
  const response = await request(platform, input, options)
  try {
    return await readLimitedText(response, maxBytes)
  } catch {
    options.signal?.throwIfAborted()
    throw new AiMediaError(502, 'UPSTREAM_INVALID_RESPONSE', '平台返回的数据无效或超出大小限制')
  }
}

export async function requestAiJson(
  platform: AiMediaPlatform,
  input: string | URL,
  options: AiRequestOptions = {}
): Promise<unknown> {
  const text = await requestAiText(platform, input, options, 4 * 1024 * 1024)
  try { return parseJsonPreservingIntegers(text) } catch {
    throw new AiMediaError(502, 'UPSTREAM_INVALID_RESPONSE', '平台返回了无效 JSON')
  }
}

export async function resolveAiUrl(
  platform: AiMediaPlatform,
  input: URL,
  options: AiMediaRequestOptions
): Promise<URL> {
  const response = await request(platform, input, options)
  await response.body?.cancel().catch(() => undefined)
  return new URL(response.url)
}
