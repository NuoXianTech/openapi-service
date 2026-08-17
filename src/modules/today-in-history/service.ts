import { load } from 'cheerio/slim'
import { AsyncCache } from '../../shared/async-cache.js'
import { readLimitedText } from '../../shared/limited-response.js'
import { safeFetch } from '../../shared/safe-fetch.js'

export interface TodayInHistoryDate {
  date: string
  month: number
  day: number
  dayKey: string
}
interface TodayInHistoryEvent {
  title: string
  year: string
  description: string
  event_type: 'birth' | 'death' | 'event'
  link: string
}
export interface TodayInHistoryData {
  date: string
  month: number
  day: number
  items: TodayInHistoryEvent[]
  total: number
}
type MonthData = Record<string, TodayInHistoryEvent[]>

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new AsyncCache<string, MonthData>({ ttlMs: CACHE_TTL_MS })
const eventLabels = { birth: '出生', death: '逝世', event: '事件' } as const
const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit'
})

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() : ''
}
function htmlText(value: unknown): string {
  const valueText = text(value)
  return valueText
    ? load(valueText, null, false).text().replace(/\s+/g, ' ').trim()
    : ''
}
function historyLink(value: unknown): string {
  const raw = text(value)
  if (!raw) return ''
  try {
    const url = new URL(raw, 'https://baike.baidu.com')
    if (
      url.hostname !== 'baike.baidu.com'
      || !['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.port
    ) return ''
    url.protocol = 'https:'
    return url.toString()
  } catch { return '' }
}
function calendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function parseTodayInHistoryDate(
  value: string,
  now: number | Date = Date.now()
): TodayInHistoryDate | null {
  const normalized = value.trim()
  let month: number
  let day: number
  if (!normalized) {
    const parts = shanghaiDate.formatToParts(
      now instanceof Date ? now : new Date(now)
    )
    month = Number(parts.find(part => part.type === 'month')?.value)
    day = Number(parts.find(part => part.type === 'day')?.value)
  } else {
    const match = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(normalized)
    if (!match) return null
    const year = match[1] ? Number(match[1]) : 2000
    month = Number(match[2])
    day = Number(match[3])
    if (year < 1 || year > 9999 || !calendarDate(year, month, day)) return null
  }
  const monthText = String(month).padStart(2, '0')
  const dayText = String(day).padStart(2, '0')
  return {
    date: `${monthText}-${dayText}`,
    month,
    day,
    dayKey: `${monthText}${dayText}`
  }
}

function normalizeEvent(value: unknown): TodayInHistoryEvent | null {
  if (!record(value)) return null
  const title = htmlText(value.title)
  const year = text(value.year)
  if (!title || !year) return null
  return {
    title,
    year,
    description: htmlText(value.desc),
    event_type: value.type === 'birth' || value.type === 'death'
      ? value.type : 'event',
    link: historyLink(value.link)
  }
}

export function normalizeHistoryMonthResponse(
  payload: unknown,
  month: number
): MonthData {
  const monthKey = String(month).padStart(2, '0')
  const source = record(payload) && record(payload[monthKey])
    ? payload[monthKey] : null
  if (!source) throw new Error('历史事件上游返回了无效月份数据')
  const result: MonthData = {}
  let total = 0
  for (const [dayKey, rawEvents] of Object.entries(source)) {
    if (
      !/^\d{4}$/.test(dayKey)
      || !dayKey.startsWith(monthKey)
      || !calendarDate(2000, month, Number(dayKey.slice(2)))
      || !Array.isArray(rawEvents)
    ) continue
    const seen = new Set<string>()
    const events = rawEvents.flatMap((value) => {
      const event = normalizeEvent(value)
      if (!event) return []
      const key = `${event.year}\0${event.title}`
      if (seen.has(key)) return []
      seen.add(key)
      return [event]
    }).sort((left, right) => {
      const leftYear = Number(left.year)
      const rightYear = Number(right.year)
      if (Number.isFinite(leftYear) && Number.isFinite(rightYear)
        && leftYear !== rightYear) return leftYear - rightYear
      if (Number.isFinite(leftYear) !== Number.isFinite(rightYear)) {
        return Number.isFinite(leftYear) ? -1 : 1
      }
      return left.title.localeCompare(right.title, 'zh-CN')
    }).slice(0, 100)
    result[dayKey] = events
    total += events.length
  }
  if (Object.keys(result).length === 0 || total === 0) {
    throw new Error('历史事件上游未返回可用事件')
  }
  return result
}

async function fetchMonth(month: number): Promise<MonthData> {
  const monthKey = String(month).padStart(2, '0')
  let response: Response
  try {
    response = await safeFetch(
      `https://baike.baidu.com/cms/home/eventsOnHistory/${monthKey}.json`,
      {
        allowedHosts: ['baike.baidu.com'],
        headers: {
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 Chrome/124 Safari/537.36'
        },
        signal: AbortSignal.timeout(10_000)
      }
    )
  } catch (error) {
    throw new Error('历史事件上游请求失败', { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`历史事件上游返回 HTTP ${response.status}`)
  }
  try {
    return normalizeHistoryMonthResponse(
      JSON.parse(await readLimitedText(response, 4 * 1024 * 1024)) as unknown,
      month
    )
  } catch (error) {
    throw new Error('历史事件上游返回了无效 JSON 数据', { cause: error })
  }
}

export async function getTodayInHistory(
  date: TodayInHistoryDate,
  signal?: AbortSignal
): Promise<TodayInHistoryData> {
  const key = String(date.month).padStart(2, '0')
  const month = await cache.get(
    key,
    () => fetchMonth(date.month),
    { signal }
  )
  const items = (month[date.dayKey] ?? []).map(item => ({ ...item }))
  return {
    date: date.date, month: date.month, day: date.day,
    items, total: items.length
  }
}

export function clearTodayInHistoryCache(): void {
  cache.clear()
}

function yearLabel(year: string): string {
  if (!/^-?\d+$/.test(year)) return `${year} 年`
  const value = Number(year)
  return value < 0 ? `公元前 ${Math.abs(value)} 年` : `公元 ${value} 年`
}

export function formatTodayInHistoryText(data: TodayInHistoryData): string {
  const items = data.items.length
    ? data.items.map((item, index) => (
        `${index + 1}. ${yearLabel(item.year)} · ${eventLabels[item.event_type]}：${item.title}`
      )).join('\n')
    : '暂无历史事件记录'
  return `历史上的今天（${data.date}）\n\n${items}`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!|<>])/g, '\\$1')
}

export function formatTodayInHistoryMarkdown(data: TodayInHistoryData): string {
  if (!data.items.length) {
    return `# 历史上的今天（${data.date}）\n\n暂无历史事件记录。`
  }
  const items = data.items.map((item, index) => {
    const title = escapeMarkdown(item.title)
    const heading = item.link ? `[${title}](<${item.link}>)` : title
    return [
      `## ${index + 1}. ${heading}`, '',
      `- 年份：${escapeMarkdown(yearLabel(item.year))}`,
      `- 类型：${eventLabels[item.event_type]}`,
      ...(item.description ? ['', escapeMarkdown(item.description)] : [])
    ].join('\n')
  }).join('\n\n---\n\n')
  return `# 历史上的今天（${data.date}）\n\n${items}`
}
