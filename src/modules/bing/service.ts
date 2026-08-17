import { readLimitedText } from '../../shared/limited-response.js'
import { waitForAbort } from '../../shared/abort.js'

const BING_BASE_URL = 'https://bing.com'
const BING_PRIMARY_URL = 'https://global.bing.com/?setmkt=zh-cn'
const BING_ARCHIVE_URL =
  'https://global.bing.com/HPImageArchive.aspx'
  + '?format=js&idx=0&n=1&setmkt=zh-cn'
const BING_CN_EDGE_IP = '157.255.219.143'
const BING_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/140.0.0.0 Safari/537.36'
const SOURCE_TIMEOUT_MS = 15_000
const MAX_PRIMARY_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 256 * 1024

const BING_ENCODES = [
  'image',
  'image-4k',
  'json',
  'text',
  'markdown',
  'md'
] as const
const BING_IMAGE_TYPES = ['auto', 'pc', 'mobile'] as const
export type BingEncode = typeof BING_ENCODES[number]
export type BingImageType = typeof BING_IMAGE_TYPES[number]

export interface BingImageRecord {
  title: string
  headline: string
  description: string
  cover: string
  cover_4k: string
  main_text: string
  copyright: string
  update_date: string
  update_date_at: number
}

interface BingArchiveResponse {
  images?: Array<{
    url?: string
    title?: string
    copyright?: string
  }>
}

interface BingPrimaryModel {
  MediaContents?: Array<{
    ImageContent?: {
      Description?: string
      Headline?: string
      Title?: string
      Copyright?: string
      Image?: { Url?: string, Wallpaper?: string }
      QuickFact?: { MainText?: string }
    }
  }>
}

interface BingCacheEntry {
  dayKey: string
  data: BingImageRecord
}

let cache: BingCacheEntry | null = null
let pendingFetch: Promise<BingImageRecord> | null = null

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})
const shanghaiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function isBingHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized === 'bing.com' || normalized.endsWith('.bing.com')
}

function extractBingImageId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, BING_BASE_URL)
    if (url.protocol !== 'https:' || !isBingHostname(url.hostname)) return null
    const id = url.searchParams.get('id')
    return id
      ? id.replace(/(?:_(?:\d+x\d+|UHD))?\.jpg$/i, '')
      : null
  } catch {
    return null
  }
}

export function createBingImageUrl(
  rawUrl: string,
  size: '1920x1080' | '768x1366' | 'UHD' = '1920x1080'
): string {
  const id = extractBingImageId(rawUrl)
  if (id) return `${BING_BASE_URL}/th?id=${id}_${size}.jpg`
  try {
    const url = new URL(rawUrl, BING_BASE_URL)
    return url.protocol === 'https:' && isBingHostname(url.hostname)
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

function isMobileUserAgent(userAgent: string): boolean {
  return /\b(mobile|android|iphone|ipod|ipad|blackberry|webos|opera mini|windows phone|iemobile|symbian)\b/i
    .test(userAgent)
}

export function resolveBingCoverUrl(
  rawUrl: string,
  type: BingImageType,
  userAgent = ''
): string {
  const mobile = type === 'mobile'
    || (type === 'auto' && isMobileUserAgent(userAgent))
  return createBingImageUrl(rawUrl, mobile ? '768x1366' : '1920x1080')
}

export function createBingMarkdown(record: BingImageRecord): string {
  const lines = [`# ${record.title || '必应每日壁纸'}`]
  if (record.headline) lines.push('', `## ${record.headline}`)
  if (record.description) lines.push('', record.description)
  lines.push('', `![${record.title}](${record.cover})`)
  if (record.copyright) lines.push('', `*${record.copyright}*`)
  return lines.join('\n')
}

function createFetchOptions(): RequestInit {
  return {
    headers: {
      accept: 'application/json,text/html,text/plain,*/*',
      'user-agent': BING_USER_AGENT,
      'x-forwarded-for': BING_CN_EDGE_IP,
      'x-real-ip': BING_CN_EDGE_IP
    },
    redirect: 'error',
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  }
}

function formatShanghaiDateTime(date: Date): string {
  return shanghaiDateTimeFormatter.format(date).replace('T', ' ')
}

function toArchiveRecord(
  image: NonNullable<BingArchiveResponse['images']>[number],
  fetchedAt = new Date()
): BingImageRecord {
  const title = image.title?.trim() || 'Bing 每日图片'
  const cover = createBingImageUrl(image.url ?? '')
  if (!cover) throw new Error('Bing archive returned an invalid image url')
  return {
    title,
    headline: title,
    description: title,
    cover,
    cover_4k: createBingImageUrl(cover, 'UHD'),
    main_text: title,
    copyright: image.copyright?.trim() || '',
    update_date: formatShanghaiDateTime(fetchedAt),
    update_date_at: fetchedAt.getTime()
  }
}

function toPrimaryRecord(
  model: BingPrimaryModel,
  fetchedAt = new Date()
): BingImageRecord | null {
  const content = model.MediaContents?.[0]?.ImageContent
  if (!content) return null
  const wallpaper = content.Image?.Wallpaper || content.Image?.Url || ''
  const cover = createBingImageUrl(wallpaper)
  if (!cover) return null
  return {
    title: content.Title || '',
    headline: content.Headline || '',
    description: content.Description || '',
    main_text: content.QuickFact?.MainText || '',
    cover,
    cover_4k: createBingImageUrl(cover, 'UHD'),
    copyright: content.Copyright || '',
    update_date: formatShanghaiDateTime(fetchedAt),
    update_date_at: fetchedAt.getTime()
  }
}

async function fetchFromPrimary(): Promise<BingImageRecord | null> {
  const response = await fetch(BING_PRIMARY_URL, createFetchOptions())
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  const html = await readLimitedText(
    response,
    MAX_PRIMARY_BYTES,
    'Bing primary response is too large'
  )
  const rawJson = /var\s*_model\s*=\s*([^;]+);/.exec(html)?.[1]
  if (!rawJson) return null
  try {
    return toPrimaryRecord(JSON.parse(rawJson) as BingPrimaryModel)
  } catch {
    return null
  }
}

async function fetchFromArchive(): Promise<BingImageRecord> {
  const response = await fetch(BING_ARCHIVE_URL, createFetchOptions())
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Bing archive responded with HTTP ${response.status}`)
  }
  const text = await readLimitedText(
    response,
    MAX_ARCHIVE_BYTES,
    'Bing archive response is too large'
  )
  const image = (JSON.parse(text) as BingArchiveResponse).images?.[0]
  if (!image?.url) {
    throw new Error('Bing archive response does not contain an image url')
  }
  return toArchiveRecord(image)
}

async function produceBingImage(): Promise<BingImageRecord> {
  return await fetchFromPrimary().catch(() => null)
    || await fetchFromArchive()
}

export function isBingEncode(value: string): value is BingEncode {
  return BING_ENCODES.includes(value as BingEncode)
}

export function isBingImageType(value: string): value is BingImageType {
  return BING_IMAGE_TYPES.includes(value as BingImageType)
}

export async function getBingImage(
  signal?: AbortSignal
): Promise<BingImageRecord> {
  const dayKey = shanghaiDayFormatter.format(new Date())
  if (cache?.dayKey === dayKey) {
    return await waitForAbort(Promise.resolve(cache.data), signal)
  }
  if (!pendingFetch) {
    pendingFetch = produceBingImage()
      .then((data) => {
        cache = { dayKey, data }
        return data
      })
      .catch((error: unknown) => {
        if (cache) return cache.data
        throw error
      })
      .finally(() => {
        pendingFetch = null
      })
  }
  return await waitForAbort(pendingFetch, signal)
}

export function clearBingCache(): void {
  cache = null
  pendingFetch = null
}
