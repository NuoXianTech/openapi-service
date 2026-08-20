import { load } from 'cheerio/slim'

const HOST_PATTERN = /^(?:[a-z0-9-]+\.)?lanzou[a-z]?\.com$/i
const FILE_PATTERN = /^i[a-z0-9_-]{5,127}$/i
const MAX_INPUT_LENGTH = 2_048

export const LANZOU_HOSTS = [
  'lanzou.com',
  ...Array.from({ length: 26 }, (_, index) => (
    `lanzou${String.fromCharCode(97 + index)}.com`
  ))
]
export const LANZOU_DOWNLOAD_HOSTS = [
  'lanrar.com',
  'lanzoug.com',
  'baidupan.com',
  'webgetstore.com',
  'woozooo.com',
  ...LANZOU_HOSTS
]

type ErrorKind = 'input' | 'business' | 'upstream'
type UnknownRecord = Record<string, unknown>

export interface LanzouFileData {
  name: string
  size: string
  url: string
}

export interface LanzouFailure {
  status: 400 | 422 | 502
  code: string
  message: string
  business: boolean
}

export interface LanzouDownloadForm {
  path: string
  body: URLSearchParams
}

export interface LanzouSharePage {
  name: string
  size: string
  protectedFile: boolean
  iframeSource: string
}

export class LanzouError extends Error {
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

export function lanzouFailure(
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

export function isLanzouHost(hostname: string): boolean {
  return HOST_PATTERN.test(hostname.toLowerCase().replace(/\.$/, ''))
}

export function isLanzouDownloadHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return LANZOU_DOWNLOAD_HOSTS.some(host => (
    normalized === host || normalized.endsWith(`.${host}`)
  ))
}

export function trustedLanzouUrl(
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
  if (!normalized) {
    throw lanzouFailure('input', 400, 'MISSING_URL', '缺少参数 url')
  }
  if (normalized.length > MAX_INPUT_LENGTH) {
    throw lanzouFailure(
      'input',
      400,
      'INVALID_URL',
      `url 不能超过 ${MAX_INPUT_LENGTH} 个字符`
    )
  }
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw lanzouFailure(
      'input', 400, 'INVALID_URL',
      'url 必须是有效的蓝奏云 HTTPS 文件分享链接'
    )
  }
  if (url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || !isLanzouHost(url.hostname)) {
    throw lanzouFailure(
      'input', 400, 'INVALID_URL',
      'url 必须是有效的蓝奏云 HTTPS 文件分享链接'
    )
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[0] ?? ''
  if (segments.length === 1 && /^b[a-z0-9_-]+$/i.test(id)) {
    throw lanzouFailure(
      'business', 422, 'UNSUPPORTED_RESOURCE',
      '暂不支持蓝奏云文件夹分享链接'
    )
  }
  if (segments.length !== 1 || !FILE_PATTERN.test(id)) {
    throw lanzouFailure(
      'input', 400, 'INVALID_URL',
      'url 必须指向单个蓝奏云分享文件'
    )
  }
  url.hash = ''
  return url
}

export function parseLanzouSharePage(html: string): LanzouSharePage {
  const $ = load(html)
  const pageText = visible($.text())
  if (/文件(?:已)?取消分享|文件不存在|来晚了.*?文件/i.test(pageText)) {
    throw lanzouFailure(
      'business', 422, 'SHARE_UNAVAILABLE',
      '该蓝奏云文件不存在或已取消分享'
    )
  }
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
  return {
    name,
    size,
    protectedFile: /function\s+down_p\s*\(/.test(html),
    iframeSource: $('iframe[src]').first().attr('src') ?? ''
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

function assertForm(path: string, sign: string): void {
  if (!path || !sign) {
    throw lanzouFailure(
      'business', 422, 'PARSE_FAILED',
      '蓝奏云分享页结构已变化，暂时无法解析'
    )
  }
}

export function createPasswordDownloadForm(
  html: string,
  password: string
): LanzouDownloadForm {
  const signs = signValues(html)
  const signVariable = html.match(
    /['"]sign['"]\s*:\s*([A-Za-z_$][\w$]*)/
  )?.[1] ?? ''
  const sign = (signVariable ? scriptValue(html, signVariable) : '')
    || signs[1]
    || signs[0]
    || ''
  const path = ajaxPath(html)
  assertForm(path, sign)
  return {
    path,
    body: new URLSearchParams({
      action: 'downprocess', sign, p: password, kd: '1'
    })
  }
}

export function createPublicDownloadForm(html: string): LanzouDownloadForm {
  const sign = scriptValue(html, 'wp_sign')
  const ajaxData = scriptValue(html, 'ajaxdata')
  const path = ajaxPath(html)
  assertForm(path, sign)
  if (!ajaxData) {
    throw lanzouFailure(
      'business', 422, 'PARSE_FAILED',
      '蓝奏云下载页结构已变化，暂时无法解析'
    )
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

export function createQueryDownloadForm(html: string): LanzouDownloadForm {
  const signs = signValues(html)
  const sign = signs[1] ?? signs[0] ?? ''
  const path = ajaxPath(html)
  assertForm(path, sign)
  return {
    path,
    body: new URLSearchParams({
      action: 'downprocess',
      websignkey: 'Em2R',
      sign,
      websign: '2',
      kd: '1',
      ves: '1'
    })
  }
}

export function parseLanzouDownloadResponse(
  payload: unknown,
  usedPassword: boolean
): { name: string, url: URL } {
  if (!isRecord(payload)) {
    throw lanzouFailure(
      'upstream', 502, 'UPSTREAM_INVALID_RESPONSE',
      '蓝奏云返回了无效数据'
    )
  }
  if (payload.zt !== 1 && payload.zt !== '1') {
    const message = text(payload.inf)
    if (usedPassword && /密码|不正确|错误/u.test(message)) {
      throw lanzouFailure(
        'business', 422, 'INVALID_PASSWORD',
        '蓝奏云分享密码不正确'
      )
    }
    if (/取消|不存在|失效/u.test(message)) {
      throw lanzouFailure(
        'business', 422, 'SHARE_UNAVAILABLE',
        '该蓝奏云文件不存在或已取消分享'
      )
    }
    throw lanzouFailure(
      'business', 422, 'PARSE_FAILED',
      '蓝奏云未返回可用的下载地址'
    )
  }
  const domain = trustedLanzouUrl(
    text(payload.dom, 2_048),
    isLanzouDownloadHost,
    true
  )
  const path = text(payload.url, 8_192).replace(/^\/+/, '')
  if (!domain || domain.pathname !== '/' || domain.search || domain.hash || !path) {
    throw lanzouFailure(
      'upstream', 502, 'UPSTREAM_INVALID_RESPONSE',
      '蓝奏云返回了无效的下载地址'
    )
  }
  const url = new URL(`/file/${path}`, domain)
  if (!url.pathname.startsWith('/file/')) {
    throw lanzouFailure(
      'upstream', 502, 'UPSTREAM_INVALID_RESPONSE',
      '蓝奏云返回了无效的下载地址'
    )
  }
  return { name: text(payload.inf), url }
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
