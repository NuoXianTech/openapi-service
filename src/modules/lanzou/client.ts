import { readLimitedText } from '../../shared/limited-response.js'
import { safeFetch } from '../../shared/safe-fetch.js'
import {
  isLanzouDownloadHost,
  isLanzouHost,
  LANZOU_DOWNLOAD_HOSTS,
  LANZOU_HOSTS,
  lanzouFailure,
  trustedLanzouUrl
} from './parser.js'

const MAX_HTML_BYTES = 1024 * 1024
const MAX_JSON_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const ACW_POSITIONS = [
  15, 35, 29, 24, 33, 16, 1, 38, 10, 9,
  19, 31, 40, 27, 22, 23, 25, 13, 6, 11,
  39, 18, 20, 8, 14, 21, 32, 26, 2, 30,
  7, 4, 17, 5, 3, 28, 34, 37, 12, 36
] as const
const ACW_MASK = '3000176000856006061501533003690027800375'
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 OpenAPI/Lanzou'
}

export interface LanzouChallengeState {
  cookie: string
}

export interface LanzouTextResponse {
  text: string
  url: URL
}

export function createAcwScV2Cookie(argument: string): string | null {
  if (!/^[0-9a-f]{40}$/i.test(argument)) return null
  const reordered = ACW_POSITIONS.map(position => argument[position - 1]).join('')
  let result = ''
  for (let index = 0; index < 40; index += 2) {
    const value = Number.parseInt(reordered.slice(index, index + 2), 16)
      ^ Number.parseInt(ACW_MASK.slice(index, index + 2), 16)
    result += value.toString(16).padStart(2, '0')
  }
  return result
}

function responseUrl(response: Response, fallback: URL): URL {
  if (!response.url) return new URL(fallback)
  return trustedLanzouUrl(response.url, isLanzouHost) ?? new URL(fallback)
}

export async function fetchLanzouText(
  url: URL,
  state: LanzouChallengeState,
  referer?: URL,
  signal?: AbortSignal
): Promise<LanzouTextResponse> {
  const request = async (): Promise<LanzouTextResponse> => {
    const response = await safeFetch(url, {
      allowedHosts: LANZOU_HOSTS,
      headers: {
        ...HEADERS,
        ...(state.cookie ? { cookie: `acw_sc__v2=${state.cookie}` } : {}),
        ...(referer ? { referer: referer.toString() } : {})
      },
      maxRedirects: 5,
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`蓝奏云返回 HTTP ${response.status}`)
    }
    return {
      text: await readLimitedText(response, MAX_HTML_BYTES),
      url: responseUrl(response, url)
    }
  }

  let result = await request()
  const argument = result.text.match(
    /var\s+arg1\s*=\s*['"]([0-9a-f]{40})['"]/i
  )?.[1]
  if (!argument) return result
  const cookie = createAcwScV2Cookie(argument)
  if (!cookie) return result
  state.cookie = cookie
  result = await request()
  return result
}

export async function postLanzouDownloadForm(
  base: URL,
  path: string,
  body: URLSearchParams,
  referer: URL,
  state: LanzouChallengeState,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await safeFetch(new URL(path, base), {
    allowedHosts: LANZOU_HOSTS,
    method: 'POST',
    body,
    maxRedirects: 0,
    headers: {
      ...HEADERS,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      referer: referer.toString(),
      'x-requested-with': 'XMLHttpRequest',
      ...(state.cookie ? { cookie: `acw_sc__v2=${state.cookie}` } : {})
    },
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`蓝奏云下载接口返回 HTTP ${response.status}`)
  }
  try {
    return JSON.parse(await readLimitedText(response, MAX_JSON_BYTES)) as unknown
  } catch (error) {
    throw lanzouFailure(
      'upstream', 502, 'UPSTREAM_INVALID_RESPONSE',
      '蓝奏云返回了无效数据', { cause: error }
    )
  }
}

async function warmDownload(
  initial: URL,
  state: LanzouChallengeState,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await safeFetch(initial, {
      allowedHosts: LANZOU_DOWNLOAD_HOSTS,
      maxRedirects: 5,
      headers: {
        ...HEADERS,
        ...(state.cookie ? { cookie: `acw_sc__v2=${state.cookie}` } : {})
      },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    await response.body?.cancel().catch(() => undefined)
  } catch (error) {
    if (signal?.aborted) throw error
  }
}

export async function resolveLanzouDownload(
  initial: URL,
  shareUrl: URL,
  state: LanzouChallengeState,
  signal?: AbortSignal
): Promise<URL> {
  await warmDownload(initial, state, signal)
  let finalUrl = new URL(initial)
  try {
    const response = await safeFetch(initial, {
      allowedHosts: LANZOU_DOWNLOAD_HOSTS,
      maxRedirects: 5,
      headers: {
        ...HEADERS,
        referer: `${shareUrl.origin}/`,
        cookie: [
          'down_ip=1',
          ...(state.cookie ? [`acw_sc__v2=${state.cookie}`] : [])
        ].join('; ')
      },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const resolved = response.url
      ? trustedLanzouUrl(response.url, isLanzouDownloadHost)
      : null
    await response.body?.cancel().catch(() => undefined)
    if (resolved) finalUrl = resolved
  } catch (error) {
    if (signal?.aborted) throw error
  }
  finalUrl.searchParams.delete('pid')
  return finalUrl
}
