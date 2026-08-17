import { waitForAbort } from '../../shared/abort.js'
import { readLimitedResponseText } from '../../shared/limited-response.js'

interface QuoteConfig { code: string, name: string, unit: string }
interface UnknownRecord { [key: string]: unknown }
interface GoldMetalPrice {
  name: string; sell_price: string; today_price: string; high_price: string
  low_price: string; unit: string; updated: string; updated_at: number
}
interface GoldStorePrice {
  brand: string; product: string; price: string; unit: string
  formatted: string; updated: string; updated_at: number
}
interface BankGoldPrice {
  bank: string; product: string; price: string; unit: string
  formatted: string; time: string; updated: string; updated_at: number
}
interface RecycleGoldPrice {
  type: string; price: string; unit: string; formatted: string
  purity: string; updated: string; updated_at: number
}
export interface GoldPriceData {
  date: string
  metals: GoldMetalPrice[]
  stores: GoldStorePrice[]
  banks: BankGoldPrice[]
  recycle: RecycleGoldPrice[]
}

const HOST = 'api.jijinhao.com'
const CACHE_TTL_MS = 2 * 60 * 1000
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_TIMESTAMP = 8_640_000_000_000_000
const METALS: readonly QuoteConfig[] = [
  { code: 'JO_71', name: '黄金_9999', unit: '元/克' },
  { code: 'JO_70', name: '黄金_9995', unit: '元/克' },
  { code: 'JO_9753', name: '黄金_T+D', unit: '元/克' },
  { code: 'JO_165732', name: '沪金主力', unit: '元/克' },
  { code: 'JO_92233', name: '伦敦金(现货黄金)', unit: '美元/盎司' },
  { code: 'JO_12552', name: '纽约黄金(COMEX)', unit: '美元/盎司' },
  { code: 'JO_92232', name: '白银价格', unit: '美元/盎司' },
  { code: 'JO_92229', name: '铂金价格', unit: '美元/盎司' },
  { code: 'JO_92230', name: '钯金价格', unit: '美元/盎司' }
]
const STORES = [
  { code: 'JO_42660', brand: '周大福', product: '黄金' },
  { code: 'JO_42657', brand: '老凤祥', product: '黄金' },
  { code: 'JO_42625', brand: '周生生', product: '黄金' },
  { code: 'JO_42634', brand: '老庙', product: '黄金' }
] as const
const BANKS = [
  { code: 'JO_78648', bank: '建设银行', product: '龙鼎金条' },
  { code: 'JO_321178', bank: '农业银行', product: '传世之宝金条' },
  { code: 'JO_78650', bank: '工商银行', product: '如意金条' },
  { code: 'JO_78656', bank: '平安银行', product: '和谐平安金条' }
] as const
const RECYCLE = [
  { code: 'JO_321453', type: '黄金回收', purity: '99.90%' },
  { code: 'JO_321465', type: '白银回收', purity: '足银' },
  { code: 'JO_321457', type: '铂金回收', purity: 'pt999' },
  { code: 'JO_321461', type: '钯金回收', purity: 'pd999' }
] as const
const codes = [
  ...METALS.map(item => item.code), ...STORES.map(item => item.code),
  ...BANKS.map(item => item.code), ...RECYCLE.map(item => item.code)
]
const URL = `https://${HOST}/quoteCenter/realTime.htm?codes=${codes.join(',')}`
const dateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})
const day = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
})

let cache: { expiresAt: number, data: GoldPriceData } | null = null
let pending: Promise<GoldPriceData> | null = null

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function string(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() : ''
}
function number(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'string' && !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function quote(payload: UnknownRecord, code: string): UnknownRecord | null {
  return isRecord(payload[code]) ? payload[code] : null
}
function digits(value: UnknownRecord): number {
  const count = number(value.digits)
  return count !== null && Number.isInteger(count) && count >= 0 && count <= 6
    ? count : 2
}
function quoteNumber(value: UnknownRecord, field: string): string {
  const parsed = number(value[field])
  if (parsed === null || parsed <= 0) return 'N/A'
  const formatted = parsed.toFixed(digits(value))
  return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted
}
function timestamp(value: UnknownRecord, fallback: number): number {
  const parsed = number(value.time)
  return parsed !== null && parsed > 0 && parsed <= MAX_TIMESTAMP
    ? Math.trunc(parsed) : fallback
}
function unit(value: UnknownRecord, fallback: string): string {
  return string(value.unit) || fallback
}

export function parseGoldQuoteScript(text: string): UnknownRecord {
  const json = /^\uFEFF?\s*var\s+quote_json\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(text)?.[1]
  if (!json) throw new Error('金价上游返回格式已变化')
  try {
    const payload = JSON.parse(json) as unknown
    if (!isRecord(payload)) throw new Error('invalid payload')
    return payload
  } catch (error) {
    throw new Error('金价上游返回了无效 JSON 数据', { cause: error })
  }
}

export function normalizeGoldPriceResponse(
  payload: unknown,
  now = Date.now()
): GoldPriceData {
  if (!isRecord(payload)) throw new Error('金价上游返回了无效行情数据')
  const metals = METALS.flatMap((config) => {
    const value = quote(payload, config.code)
    if (!value) return []
    const updatedAt = timestamp(value, now)
    return [{
      name: config.name, sell_price: quoteNumber(value, 'q63'),
      today_price: quoteNumber(value, 'q1'), high_price: quoteNumber(value, 'q3'),
      low_price: quoteNumber(value, 'q4'), unit: unit(value, config.unit),
      updated: dateTime.format(updatedAt), updated_at: updatedAt
    }]
  })
  if (metals.length === 0 || !metals.some(item => item.sell_price !== 'N/A')) {
    throw new Error('金价上游未返回可用贵金属行情')
  }
  const stores = STORES.flatMap((config) => {
    const value = quote(payload, config.code)
    if (!value) return []
    const price = quoteNumber(value, 'q63')
    const priceUnit = unit(value, '元/克')
    const updatedAt = timestamp(value, now)
    return [{ ...config, price, unit: priceUnit,
      formatted: price === 'N/A' ? price : `${price}${priceUnit}`,
      updated: day.format(updatedAt), updated_at: updatedAt }]
  }).map(({ code: _, ...item }) => item)
  const banks = BANKS.flatMap((config) => {
    const value = quote(payload, config.code)
    if (!value) return []
    const price = quoteNumber(value, 'q63')
    const priceUnit = unit(value, '元/克')
    const updatedAt = timestamp(value, now)
    return [{ ...config, price, unit: priceUnit,
      formatted: price === 'N/A' ? price : `${price}${priceUnit}`,
      time: dateTime.format(updatedAt).slice(11),
      updated: dateTime.format(updatedAt), updated_at: updatedAt }]
  }).map(({ code: _, ...item }) => item)
  const recycle = RECYCLE.flatMap((config) => {
    const value = quote(payload, config.code)
    if (!value) return []
    const price = quoteNumber(value, 'q63')
    const priceUnit = unit(value, '元/克')
    const updatedAt = timestamp(value, now)
    return [{ ...config, price, unit: priceUnit,
      formatted: price === 'N/A' ? price : `${price}${priceUnit}`,
      updated: day.format(updatedAt), updated_at: updatedAt }]
  }).map(({ code: _, ...item }) => item)
  return { date: day.format(now), metals, stores, banks, recycle }
}

async function fetchGoldPrice(): Promise<GoldPriceData> {
  let response: Response
  try {
    response = await fetch(URL, {
      headers: {
        accept: 'application/javascript,text/javascript,*/*;q=0.8',
        referer: 'https://quote.cngold.org/',
        'user-agent': 'Mozilla/5.0 Chrome/124 Safari/537.36'
      },
      redirect: 'error', signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    throw new Error('金价上游请求失败', { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`金价上游返回 HTTP ${response.status}`)
  }
  const script = await readLimitedResponseText(
    response, MAX_RESPONSE_BYTES, '金价上游响应过大'
  )
  return normalizeGoldPriceResponse(parseGoldQuoteScript(script))
}

export async function getGoldPrice(signal?: AbortSignal): Promise<GoldPriceData> {
  if (!cache || cache.expiresAt <= Date.now()) {
    pending ??= fetchGoldPrice().then((data) => {
      cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
      return data
    }).finally(() => { pending = null })
    await waitForAbort(pending, signal)
  }
  return structuredClone(cache!.data)
}

export function clearGoldPriceCache(): void {
  cache = null
  pending = null
}

function latest(data: GoldPriceData): number {
  return Math.max(...[
    ...data.metals, ...data.stores, ...data.banks, ...data.recycle
  ].map(item => item.updated_at))
}
export function formatGoldPriceText(data: GoldPriceData): string {
  const metals = data.metals.map(item => `${item.name}: ${item.sell_price}${item.sell_price === 'N/A' ? '' : item.unit}`).join('\n')
  const stores = data.stores.map(item => `${item.brand}: ${item.formatted}`).join('\n') || '暂无数据'
  const banks = data.banks.map(item => `${item.bank}: ${item.formatted}`).join('\n') || '暂无数据'
  const recycle = data.recycle.map(item => `${item.type}: ${item.formatted}`).join('\n') || '暂无数据'
  return `贵金属价格 (${dateTime.format(latest(data))})\n\n〓 实时行情 〓\n${metals}\n\n〓 各大金店今日金价 〓\n${stores}\n\n〓 银行金条今日金价 〓\n${banks}\n\n〓 黄金回收今日金价 〓\n${recycle}`
}
function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([|<>])/g, '\\$1').replace(/[\r\n]+/g, ' ')
}
export function formatGoldPriceMarkdown(data: GoldPriceData): string {
  const metalRows = data.metals.map(item => `| ${escapeCell(item.name)} | ${item.sell_price} | ${item.today_price} | ${item.high_price} | ${item.low_price} | ${escapeCell(item.unit)} |`).join('\n')
  const storeRows = data.stores.map(item => `| ${escapeCell(item.brand)} | ${escapeCell(item.product)} | ${escapeCell(item.formatted)} | ${item.updated} |`).join('\n') || '| 暂无数据 | - | - | - |'
  const bankRows = data.banks.map(item => `| ${escapeCell(item.bank)} | ${escapeCell(item.product)} | ${escapeCell(item.formatted)} | ${item.updated} |`).join('\n') || '| 暂无数据 | - | - | - |'
  const recycleRows = data.recycle.map(item => `| ${escapeCell(item.type)} | ${escapeCell(item.formatted)} | ${escapeCell(item.purity)} | ${item.updated} |`).join('\n') || '| 暂无数据 | - | - | - |'
  return `# 贵金属价格\n\n**更新时间**：${dateTime.format(latest(data))}\n\n## 实时行情\n\n| 品种 | 最新价 | 今日开盘 | 最高价 | 最低价 | 单位 |\n|------|--------|----------|--------|--------|------|\n${metalRows}\n\n## 各大金店今日金价\n\n| 黄金品牌 | 黄金品种 | 今日价格 | 报价日期 |\n|----------|----------|----------|----------|\n${storeRows}\n\n## 银行金条今日金价\n\n| 银行 | 金条品种 | 今日价格 | 报价时间 |\n|------|----------|----------|----------|\n${bankRows}\n\n## 黄金回收今日金价\n\n| 黄金种类 | 回收价格 | 纯度 | 报价日期 |\n|----------|----------|------|----------|\n${recycleRows}`
}
