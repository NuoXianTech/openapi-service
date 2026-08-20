import { load } from 'cheerio/slim'
import { AsyncCache } from '../../shared/async-cache.js'
import { readLimitedText } from '../../shared/limited-response.js'
import regionsJson from './regions.json' with { type: 'json' }

const BASE_URL = 'http://www.qiyoujiage.com'
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_CACHE_ENTRIES = 128
const SOURCE_TIMEOUT_MS = 15_000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})

export interface FuelRegion { region: string, url: string }
export interface FuelPriceItem { name: string, price: number, price_desc: string }
export interface FuelTrend {
  next_adjustment_date: string
  direction: string
  change_ton: number
  change_ton_desc: string
  change_liter_min: number
  change_liter_max: number
  change_liter_desc: string
  description: string
}
export interface FuelPriceData {
  region: string
  trend: FuelTrend | null
  items: FuelPriceItem[]
  link: string
  updated: string
  updated_at: number
}
interface CacheEntry {
  timestamp: number
  items: FuelPriceItem[]
  trend: FuelTrend | null
}

const regions = (regionsJson as FuelRegion[]).slice()
const sortedRegions = regions.toSorted((first, second) => (
  first.region.length - second.region.length
))
const cache = new AsyncCache<string, CacheEntry>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES
})

export function listFuelRegions() {
  return regions.map(region => ({
    ...region,
    link: `${BASE_URL}${region.url}`
  }))
}

export function findFuelRegion(value: string): FuelRegion | null {
  const keyword = value.trim().replace(/\s+/g, '')
  if (!keyword) return null
  return sortedRegions.find(region => region.region.endsWith(keyword)) ?? null
}

export function parseFuelPrices(html: string): FuelPriceItem[] {
  const $ = load(html)
  const items: FuelPriceItem[] = []
  $('#youjia dl').each((_, element) => {
    const terms = $(element).find('dt')
    const descriptions = $(element).find('dd')
    terms.each((index, term) => {
      const name = $(term).text().trim().replace(/^[^0-9]+/, '')
      const price = Number.parseFloat($(descriptions[index]).text().trim())
      if (name && Number.isFinite(price)) {
        items.push({ name, price, price_desc: `${price.toFixed(2)} 元/升` })
      }
    })
  })
  return items
}

export function parseFuelTrend(html: string): FuelTrend | null {
  const $ = load(html)
  const trend = $('#youjiaCont > div').filter((_, element) => {
    const style = $(element).attr('style') ?? ''
    return style.includes('border') && style.includes('#EA5146')
  }).first()
  const text = (trend.length ? trend.text() : $('#left > div').first().text())
    .replace(/\s+/g, '')
  if (!text) return null
  const date = /下次油价(\d+月\d+日\d+时)调整/.exec(text)?.[1] ?? ''
  const direction = /预计(上调|下调|搁浅)/.exec(text)?.[1]
  const ton = /(上调|下调)(\d+)元\/吨/.exec(text)
  const liter = /\((\d+\.?\d*)元\/升[-~](\d+\.?\d*)元\/升\)/.exec(text)
  if (!date && !direction) return null
  const normalizedDirection = direction ?? '搁浅'
  const changeTon = ton ? Number.parseInt(ton[2] ?? '0', 10) : 0
  const minimum = liter ? Number.parseFloat(liter[1] ?? '0') : 0
  const maximum = liter ? Number.parseFloat(liter[2] ?? '0') : 0
  const tonDescription = ton ? `${normalizedDirection}${ton[2]}元/吨` : ''
  const literDescription = minimum && maximum
    ? `${minimum.toFixed(2)}元/升-${maximum.toFixed(2)}元/升`
    : ''
  const descriptions: string[] = []
  if (date) descriptions.push(`下次调价时间: ${date}`)
  descriptions.push(normalizedDirection === '搁浅'
    ? '预计搁浅（不调整）'
    : `预计${tonDescription}${literDescription ? ` (${literDescription})` : ''}`)
  return {
    next_adjustment_date: date,
    direction: normalizedDirection,
    change_ton: changeTon,
    change_ton_desc: tonDescription,
    change_liter_min: minimum,
    change_liter_max: maximum,
    change_liter_desc: literDescription,
    description: descriptions.join('，')
  }
}

async function fetchEntry(region: FuelRegion): Promise<CacheEntry> {
  const response = await fetch(`${BASE_URL}${region.url}`, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'error',
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`油价上游返回 HTTP ${response.status}`)
  }
  const html = await readLimitedText(
    response,
    MAX_RESPONSE_BYTES,
    '油价上游响应过大'
  )
  const items = parseFuelPrices(html)
  if (items.length === 0) throw new Error('油价页面结构异常，未解析到价格列表')
  return {
    timestamp: Date.now(),
    items,
    trend: parseFuelTrend(html)
  }
}

async function getEntry(
  region: FuelRegion,
  forceUpdate: boolean,
  signal?: AbortSignal
): Promise<CacheEntry> {
  const key = region.url
  return cache.get(
    key,
    () => fetchEntry(region),
    { forceRefresh: forceUpdate, signal }
  )
}

export async function getFuelPriceData(
  region: FuelRegion,
  forceUpdate = false,
  signal?: AbortSignal
): Promise<FuelPriceData> {
  const entry = await getEntry(region, forceUpdate, signal)
  return {
    region: region.region,
    trend: entry.trend,
    items: entry.items,
    link: `${BASE_URL}${region.url}`,
    updated: formatter.format(entry.timestamp),
    updated_at: entry.timestamp
  }
}

export function clearFuelPriceCache(): void {
  cache.clear()
}

export function formatFuelPriceText(data: FuelPriceData): string {
  return [
    `今日油价 (${data.region})`, '',
    data.items.map(item => `${item.name}: ${item.price_desc}`).join('\n'),
    ...(data.trend ? ['', data.trend.description] : []),
    '', `更新时间: ${data.updated}`
  ].join('\n')
}

export function formatFuelPriceMarkdown(data: FuelPriceData): string {
  return [
    `# 今日油价 (${data.region})`, '',
    data.items.map(item => `- **${item.name}**: ${item.price_desc}`).join('\n'),
    ...(data.trend ? ['', `> ${data.trend.description}`] : []),
    '', `更新时间: ${data.updated}`
  ].join('\n')
}
