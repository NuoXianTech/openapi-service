const DAILY_60S_SOURCES = [
  (date: string) => `https://60s-static.viki.moe/60s/${date}.json`,
  (date: string) =>
    'https://raw.githubusercontent.com/vikiboss/60s-static-host/'
    + `refs/heads/main/static/60s/${date}.json`
] as const
const MAX_RESPONSE_BYTES = 256 * 1024
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE_ENTRIES = 64
const MAX_NEWS_ITEMS = 30
const MAX_NEWS_LENGTH = 1_000
const SOURCE_TIMEOUT_MS = 8_000

const shanghaiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})
const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})
const chineseCalendarFormatter = new Intl.DateTimeFormat(
  'zh-CN-u-ca-chinese',
  {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }
)
const weekdays = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六'
] as const

type UnknownRecord = Record<string, unknown>

export interface Daily60sData {
  date: string
  news: string[]
  cover: string
  tip: string
  link: string
  created: string
  created_at: number
  updated: string
  updated_at: number
  day_of_week: string
  lunar_date: string
  api_updated: string
  api_updated_at: number
}

interface CacheEntry {
  expiresAt: number
  value: Promise<Daily60sData | null>
}

const cache = new Map<string, CacheEntry>()

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function readText(value: unknown, maxLength = MAX_NEWS_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function readTimestamp(value: unknown): number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : 0
}

function normalizeHttpsUrl(value: unknown): string {
  const text = readText(value, 4_096)
  if (!text) return ''
  try {
    const url = new URL(text)
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || (url.port && url.port !== '443')
    ) return ''
    return url.toString()
  } catch {
    return ''
  }
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const isoDate = [year, month, day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
  const date = new Date(`${isoDate}T00:00:00Z`)
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function parseDaily60sDate(
  value: string,
  now: number | Date = Date.now()
): string | null {
  const normalized = value.trim()
  if (!normalized) {
    return shanghaiDateFormatter.format(
      now instanceof Date ? now : new Date(now)
    )
  }

  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  return year >= 1
    && year <= 9999
    && isValidDateParts(year, month, day)
    ? normalized
    : null
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00+08:00`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function formatChineseDay(day: number): string {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (day <= 10) return `初${day === 10 ? '十' : digits[day]}`
  if (day < 20) return `十${digits[day - 10]}`
  if (day === 20) return '二十'
  if (day < 30) return `廿${digits[day - 20]}`
  return '三十'
}

function lunarDate(date: string): string {
  const parts = chineseCalendarFormatter.formatToParts(
    new Date(`${date}T12:00:00+08:00`)
  ) as Array<{ type: string, value: string }>
  const yearName = parts.find(part => part.type === 'yearName')?.value ?? ''
  const month = parts.find(part => part.type === 'month')?.value ?? ''
  const day = Number(parts.find(part => part.type === 'day')?.value)
  return yearName && month && day >= 1 && day <= 30
    ? `${yearName}年${month}${formatChineseDay(day)}`
    : ''
}

function dayOfWeek(date: string): string {
  return weekdays[new Date(`${date}T12:00:00+08:00`).getUTCDay()] ?? ''
}

export function normalizeDaily60sResponse(
  payload: unknown,
  expectedDate: string,
  now = Date.now()
): Daily60sData {
  const record = asRecord(payload)
  if (
    readText(record.date, 10) !== expectedDate
    || !Array.isArray(record.news)
  ) {
    throw new Error('每日 60 秒上游返回了无效数据')
  }
  const news = record.news
    .slice(0, MAX_NEWS_ITEMS)
    .map((item) => typeof item === 'string'
      ? readText(item)
      : readText(asRecord(item).title))
    .filter(Boolean)
  if (news.length === 0) {
    throw new Error('每日 60 秒上游未返回新闻内容')
  }

  return {
    date: expectedDate,
    news,
    cover: normalizeHttpsUrl(record.cover),
    tip: readText(record.tip),
    link: normalizeHttpsUrl(record.link),
    created: readText(record.created, 64),
    created_at: readTimestamp(record.created_at),
    updated: readText(record.updated, 64),
    updated_at: readTimestamp(record.updated_at),
    day_of_week: dayOfWeek(expectedDate),
    lunar_date: lunarDate(expectedDate),
    api_updated: shanghaiDateTimeFormatter.format(now),
    api_updated_at: now
  }
}

async function fetchDaily60s(
  date: string,
  signal?: AbortSignal
): Promise<Daily60sData | null> {
  let lastError: unknown
  let wasNotFound = false
  for (const source of DAILY_60S_SOURCES) {
    try {
      const sourceSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)])
        : AbortSignal.timeout(SOURCE_TIMEOUT_MS)
      const response = await fetch(source(date), {
        headers: {
          accept: 'application/json',
          'user-agent': 'openapi-service/60s'
        },
        redirect: 'error',
        signal: sourceSignal
      })
      if (response.status === 404) {
        wasNotFound = true
        await response.body?.cancel().catch(() => undefined)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new Error(`上游返回 HTTP ${response.status}`)
      }
      const text = await readLimitedResponseText(
        response,
        MAX_RESPONSE_BYTES,
        '每日 60 秒上游响应过大'
      )
      return normalizeDaily60sResponse(JSON.parse(text) as unknown, date)
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  if (wasNotFound) return null
  if (lastError) {
    throw new Error('每日 60 秒上游请求失败', { cause: lastError })
  }
  return null
}

function trimCache(): void {
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cache.delete(oldest)
  }
}

async function getDaily60sByDate(
  date: string,
  signal?: AbortSignal
): Promise<Daily60sData | null> {
  const now = Date.now()
  const existing = cache.get(date)
  if (existing && existing.expiresAt > now) return await existing.value
  if (existing) cache.delete(date)

  trimCache()
  const value = fetchDaily60s(date, signal)
  cache.set(date, { expiresAt: now + CACHE_TTL_MS, value })
  value.catch(() => {
    if (cache.get(date)?.value === value) cache.delete(date)
  })
  return await value
}

export async function getDaily60s(
  date: string,
  options: { fallback?: boolean, signal?: AbortSignal } = {}
): Promise<Daily60sData> {
  const dates = options.fallback
    ? [date, shiftDate(date, -1), shiftDate(date, -2)]
    : [date]
  for (const candidate of dates) {
    const data = await getDaily60sByDate(candidate, options.signal)
    if (data) return data
  }
  throw new Error(
    options.fallback
      ? '最近三天暂无每日 60 秒内容'
      : `${date} 暂无每日 60 秒内容`
  )
}

export function clearDaily60sCache(): void {
  cache.clear()
}

export function formatDaily60sText(data: Daily60sData): string {
  const heading = `每天 60s 读懂世界（${data.date} ${data.day_of_week}）`
  const news = data.news
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n')
  return [heading, news, data.tip ? `【微语】${data.tip}` : '']
    .filter(Boolean)
    .join('\n\n')
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!|<>])/g, '\\$1')
}

export function formatDaily60sMarkdown(data: Daily60sData): string {
  const news = data.news
    .map((item, index) => `${index + 1}. ${escapeMarkdownText(item)}`)
    .join('\n')
  const metadata = [data.date, data.day_of_week, data.lunar_date]
    .filter(Boolean)
    .join(' ')
  const tip = data.tip
    ? `\n\n---\n\n**微语：** ${escapeMarkdownText(data.tip)}`
    : ''
  return `# 每天 60s 读懂世界\n\n> ${metadata}\n\n${news}${tip}`
}
import { readLimitedResponseText } from '../../shared/limited-response.js'
