import { load } from 'cheerio/slim'
import { readLimitedText } from '../../shared/limited-response.js'
import { safeFetch } from '../../shared/safe-fetch.js'

const HOST_PATTERN = /^(?:[a-z0-9-]+\.)?lanzou[a-z]?\.com$/i
const FILE_PATTERN = /^i[a-z0-9_-]{5,127}$/i
const LANZOU_HOSTS = [
  'lanzou.com',
  ...Array.from({ length: 26 }, (_, index) => (
    `lanzou${String.fromCharCode(97 + index)}.com`
  ))
]
const DOWNLOAD_HOSTS = [
  'lanrar.com',
  'lanzoug.com',
  'baidupan.com',
  'webgetstore.com',
  'woozooo.com',
  ...LANZOU_HOSTS
]
const MAX_INPUT_LENGTH = 2_048
const MAX_HTML_BYTES = 1024 * 1024
const MAX_JSON_BYTES = 64 * 1024
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

type ErrorKind = 'input' | 'business' | 'upstream'
type UnknownRecord = Record<string, unknown>
export interface LanzouFileData { name: string, size: string, url: string }
export interface LanzouFailure {
  status: 400 | 422 | 502
  code: string
  message: string
  business: boolean
}
interface ChallengeState { cookie: string }
interface TextResponse { text: string, url: URL }

class LanzouError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status: 400 | 422 | 502,
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
  }
}

function failure(
  kind: ErrorKind,
  status: 400 | 422 | 502,
  code: string,
  message: string,
  options?: ErrorOptions
): LanzouError {
  return new LanzouError(kind, status, code, message, options)
}
function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, maximum = 512): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}
function visible(value: string): string {
  return load(value, null, false).text().replace(/\s+/g, ' ').trim()
}
function isLanzouHost(hostname: string): boolean {
  return HOST_PATTERN.test(hostname.toLowerCase().replace(/\.$/, ''))
}
function isDownloadHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return DOWNLOAD_HOSTS.some(host => (
    normalized === host || normalized.endsWith(`.${host}`)
  ))
}
function trustedHttpsUrl(
  value: string,
  allowed: (hostname: string) => boolean,
  upgradeHttp = false
): URL | null {
  try {
    const url = new URL(value)
    if (upgradeHttp && url.protocol === 'http:') url.protocol = 'https:'
    if (url.protocol !== 'https:' || url.username || url.password
      || (url.port && url.port !== '443')) return null
    return allowed(url.hostname) ? url : null
  } catch {
    return null
  }
}

export function parseLanzouShareUrl(input: string): URL {
  const normalized = input.trim()
  if (!normalized) throw failure('input', 400, 'MISSING_URL', '缺少参数 url')
  if (normalized.length > MAX_INPUT_LENGTH) {
    throw failure('input', 400, 'INVALID_URL', `url 不能超过 ${MAX_INPUT_LENGTH} 个字符`)
  }
  let url: URL
  try { url = new URL(normalized) } catch {
    throw failure('input', 400, 'INVALID_URL', 'url 必须是有效的蓝奏云 HTTPS 文件分享链接')
  }
  if (url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || !isLanzouHost(url.hostname)) {
    throw failure('input', 400, 'INVALID_URL', 'url 必须是有效的蓝奏云 HTTPS 文件分享链接')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[0] ?? ''
  if (segments.length === 1 && /^b[a-z0-9_-]+$/i.test(id)) {
    throw failure('business', 422, 'UNSUPPORTED_RESOURCE', '暂不支持蓝奏云文件夹分享链接')
  }
  if (segments.length !== 1 || !FILE_PATTERN.test(id)) {
    throw failure('input', 400, 'INVALID_URL', 'url 必须指向单个蓝奏云分享文件')
  }
  url.protocol = 'https:'
  url.hash = ''
  return url
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
  return trustedHttpsUrl(response.url, isLanzouHost) ?? new URL(fallback)
}

async function fetchLanzouText(
  url: URL,
  state: ChallengeState,
  referer?: URL,
  signal?: AbortSignal
): Promise<TextResponse> {
  const request = async (): Promise<TextResponse> => {
    const response = await safeFetch(url, {
      allowedHosts: LANZOU_HOSTS,
      headers: {
        ...HEADERS,
        ...(state.cookie ? { cookie: `acw_sc__v2=${state.cookie}` } : {}),
        ...(referer ? { referer: referer.toString() } : {})
      },
      maxRedirects: 5,
      signal: signal ?? AbortSignal.timeout(10_000)
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

function metadata(html: string): { name: string, size: string } {
  const $ = load(html)
  const name = [
    $('#filenajax').first().text(),
    $('.n_box_3fn').first().text(),
    $('[style*="font-size: 30px"]').first().text(),
    html.match(/var\s+filename\s*=\s*['"]([^'"]+)['"]/i)?.[1] ?? '',
    $('.b > span').first().text()
  ].map(visible).find(value => value && value !== '文件') ?? ''
  const size = [
    $('.n_filesize').first().text().replace(/^\s*大小[：:]\s*/u, ''),
    html.match(/<span[^>]*class=["']p7["'][^>]*>\s*文件大小[：:]\s*<\/span>\s*([^<]+)/iu)?.[1] ?? ''
  ].map(visible).find(Boolean) ?? ''
  return { name, size }
}

function assertAvailable(html: string): void {
  const pageText = visible(load(html).text())
  if (/文件(?:已)?取消分享|文件不存在|来晚了.*?文件/i.test(pageText)) {
    throw failure('business', 422, 'SHARE_UNAVAILABLE', '该蓝奏云文件不存在或已取消分享')
  }
}

function scriptValue(source: string, variable: string): string {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(
    new RegExp(`\\b(?:var\\s+)?${escaped}\\s*=\\s*['"]([^'"]+)['"]`)
  )?.[1] ?? ''
}

function signValues(source: string): string[] {
  return [...source.matchAll(
    /['"]sign['"]\s*:\s*['"]([^'"]+)['"]/g
  )].map(match => match[1] ?? '').filter(value => value && value !== '<1>')
}

function ajaxPath(source: string): string {
  const paths = [...source.matchAll(
    /(?:^|\/)(ajax(?:m|file)\.php\?file=\d+)/gm
  )].map(match => match[1] ?? '')
  const path = paths.at(-1)
  return path ? `/${path}` : ''
}

function passwordForm(html: string, password: string) {
  const signs = signValues(html)
  const signVariable = html.match(
    /['"]sign['"]\s*:\s*([A-Za-z_$][\w$]*)/
  )?.[1] ?? ''
  const sign = (signVariable ? scriptValue(html, signVariable) : '')
    || signs[1]
    || signs[0]
    || ''
  const path = ajaxPath(html)
  if (!path || !sign) {
    throw failure('business', 422, 'PARSE_FAILED', '蓝奏云分享页结构已变化，暂时无法解析')
  }
  return {
    path,
    body: new URLSearchParams({
      action: 'downprocess', sign, p: password, kd: '1'
    })
  }
}

function publicForm(html: string) {
  const sign = scriptValue(html, 'wp_sign')
  const ajaxData = scriptValue(html, 'ajaxdata')
  const path = ajaxPath(html)
  if (!path || !sign || !ajaxData) {
    throw failure('business', 422, 'PARSE_FAILED', '蓝奏云下载页结构已变化，暂时无法解析')
  }
  return {
    path,
    body: new URLSearchParams({
      action: 'downprocess',
      websignkey: ajaxData,
      signs: ajaxData,
      sign,
      websign: '',
      kd: '1',
      ves: '1'
    })
  }
}

function queryPageForm(html: string) {
  const signs = signValues(html)
  const sign = signs[1] ?? signs[0] ?? ''
  const path = ajaxPath(html)
  if (!path || !sign) {
    throw failure('business', 422, 'PARSE_FAILED', '蓝奏云分享页结构已变化，暂时无法解析')
  }
  return {
    path,
    body: new URLSearchParams({
      action: 'downprocess', websignkey: 'Em2R', sign,
      websign: '2', kd: '1', ves: '1'
    })
  }
}

async function postDownloadForm(
  base: URL,
  path: string,
  body: URLSearchParams,
  referer: URL,
  state: ChallengeState,
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
    signal: signal ?? AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`蓝奏云下载接口返回 HTTP ${response.status}`)
  }
  try {
    return JSON.parse(await readLimitedText(response, MAX_JSON_BYTES)) as unknown
  } catch (error) {
    throw failure(
      'upstream', 502, 'UPSTREAM_INVALID_RESPONSE',
      '蓝奏云返回了无效数据', { cause: error }
    )
  }
}

function downloadResponse(payload: unknown, usedPassword: boolean) {
  if (!isRecord(payload)) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', '蓝奏云返回了无效数据')
  }
  if (payload.zt !== 1 && payload.zt !== '1') {
    const message = text(payload.inf)
    if (usedPassword && /密码|不正确|错误/u.test(message)) {
      throw failure('business', 422, 'INVALID_PASSWORD', '蓝奏云分享密码不正确')
    }
    if (/取消|不存在|失效/u.test(message)) {
      throw failure('business', 422, 'SHARE_UNAVAILABLE', '该蓝奏云文件不存在或已取消分享')
    }
    throw failure('business', 422, 'PARSE_FAILED', '蓝奏云未返回可用的下载地址')
  }
  const domain = trustedHttpsUrl(
    text(payload.dom, 2_048),
    isDownloadHost,
    true
  )
  const path = text(payload.url, 8_192).replace(/^\/+/, '')
  if (!domain || domain.pathname !== '/' || domain.search || domain.hash || !path) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', '蓝奏云返回了无效的下载地址')
  }
  const url = new URL(`/file/${path}`, domain)
  if (!url.pathname.startsWith('/file/')) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', '蓝奏云返回了无效的下载地址')
  }
  return { name: text(payload.inf), url }
}

async function warmDownload(
  initial: URL,
  state: ChallengeState,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await safeFetch(initial, {
      allowedHosts: DOWNLOAD_HOSTS,
      maxRedirects: 5,
      headers: {
        ...HEADERS,
        ...(state.cookie ? { cookie: `acw_sc__v2=${state.cookie}` } : {})
      },
      signal: signal ?? AbortSignal.timeout(10_000)
    })
    await response.body?.cancel().catch(() => undefined)
  } catch (error) {
    if (signal?.aborted) throw error
  }
}

async function resolveFinalDownload(
  initial: URL,
  shareUrl: URL,
  state: ChallengeState,
  signal?: AbortSignal
): Promise<URL> {
  await warmDownload(initial, state, signal)
  let finalUrl = new URL(initial)
  try {
    const response = await safeFetch(initial, {
      allowedHosts: DOWNLOAD_HOSTS,
      maxRedirects: 5,
      headers: {
        ...HEADERS,
        referer: `${shareUrl.origin}/`,
        cookie: [
          'down_ip=1',
          ...(state.cookie ? [`acw_sc__v2=${state.cookie}`] : [])
        ].join('; ')
      },
      signal: signal ?? AbortSignal.timeout(10_000)
    })
    const resolved = response.url
      ? trustedHttpsUrl(response.url, isDownloadHost)
      : null
    await response.body?.cancel().catch(() => undefined)
    if (resolved) {
      finalUrl = resolved
    }
  } catch (error) {
    if (signal?.aborted) throw error
  }
  finalUrl.searchParams.delete('pid')
  return finalUrl
}

export async function parseLanzouFile(
  source: URL,
  password = '',
  signal?: AbortSignal
): Promise<LanzouFileData> {
  try {
    const state: ChallengeState = { cookie: '' }
    let share: TextResponse
    try {
      share = await fetchLanzouText(source, state, undefined, signal)
    } catch (originalError) {
      if (signal?.aborted || source.hostname === 'www.lanzouf.com') {
        throw originalError
      }
      const fallbackUrl = new URL(source)
      fallbackUrl.hostname = 'www.lanzouf.com'
      state.cookie = ''
      try {
        share = await fetchLanzouText(
          fallbackUrl,
          state,
          undefined,
          signal
        )
      } catch (fallbackError) {
        throw new AggregateError(
          [originalError, fallbackError],
          '蓝奏云原始域名和备用域名均请求失败'
        )
      }
    }
    assertAvailable(share.text)
    const file = metadata(share.text)
    const protectedFile = /function\s+down_p\s*\(/.test(share.text)
    let form: { path: string, body: URLSearchParams }
    let referer = share.url
    let formBase = share.url

    if (protectedFile && !source.search) {
      if (!password) {
        throw failure('input', 400, 'PASSWORD_REQUIRED', '该蓝奏云文件需要提供 pwd 分享密码')
      }
      form = passwordForm(share.text, password)
    } else if (source.search) {
      form = queryPageForm(share.text)
    } else {
      const iframeSource = load(share.text)('iframe[src]').first().attr('src') ?? ''
      let iframe: URL | null = null
      try {
        iframe = trustedHttpsUrl(
          new URL(iframeSource, share.url).toString(),
          isLanzouHost
        )
      } catch { /* handled below */ }
      if (!iframeSource || !iframe) {
        throw failure('business', 422, 'PARSE_FAILED', '蓝奏云分享页结构已变化，暂时无法解析')
      }
      const downloadPage = await fetchLanzouText(
        iframe,
        state,
        share.url,
        signal
      )
      form = publicForm(downloadPage.text)
      referer = downloadPage.url
      formBase = downloadPage.url
    }

    const payload = await postDownloadForm(
      formBase,
      form.path,
      form.body,
      referer,
      state,
      signal
    )
    const result = downloadResponse(payload, protectedFile)
    const finalUrl = await resolveFinalDownload(
      result.url,
      share.url,
      state,
      signal
    )
    return {
      name: result.name || file.name,
      size: file.size,
      url: finalUrl.toString()
    }
  } catch (error) {
    if (error instanceof LanzouError) throw error
    throw failure(
      'upstream', 502, 'UPSTREAM_ERROR',
      '请求蓝奏云服务失败', { cause: error }
    )
  }
}

export function classifyLanzouError(error: unknown): LanzouFailure {
  return error instanceof LanzouError
    ? {
        status: error.status,
        code: error.code,
        message: error.message,
        business: error.kind !== 'input'
      }
    : {
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: '请求蓝奏云服务失败',
        business: true
      }
}
