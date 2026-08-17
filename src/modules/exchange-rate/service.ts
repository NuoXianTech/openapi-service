import { readLimitedResponseText } from '../../shared/limited-response.js'

const API_URL = 'https://open.er-api.com/v6/latest'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_RESPONSE_BYTES = 512 * 1024
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
})

export interface ExchangeRateData {
  base_code: string
  updated: string
  updated_at: number
  next_updated: string
  next_updated_at: number
  rates: Array<{ currency: string, rate: number }>
}

interface CacheEntry { expiresAt: number, data: ExchangeRateData }
const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<ExchangeRateData>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeCurrencyCode(value: string): string | null {
  const currency = value.trim().toUpperCase()
  return CURRENCY_PATTERN.test(currency) ? currency : null
}

export function normalizeExchangeRateResponse(payload: unknown): ExchangeRateData {
  if (!isRecord(payload) || payload.result !== 'success') {
    throw new Error('汇率上游请求失败')
  }
  const baseCode = typeof payload.base_code === 'string'
    ? payload.base_code.toUpperCase()
    : ''
  if (!CURRENCY_PATTERN.test(baseCode)) {
    throw new Error('汇率上游返回了无效基准货币')
  }
  const toMilliseconds = (value: unknown) => {
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('汇率上游返回了无效更新时间')
    }
    return seconds * 1000
  }
  if (!isRecord(payload.rates)) {
    throw new Error('汇率上游返回了无效汇率数据')
  }
  const rates = Object.entries(payload.rates).flatMap(([currency, value]) => {
    const rate = Number(value)
    return CURRENCY_PATTERN.test(currency) && Number.isFinite(rate)
      ? [{ currency, rate }]
      : []
  })
  if (rates.length === 0) throw new Error('汇率上游未返回可用汇率')
  const updatedAt = toMilliseconds(payload.time_last_update_unix)
  const nextUpdatedAt = toMilliseconds(payload.time_next_update_unix)
  return {
    base_code: baseCode,
    updated: formatter.format(updatedAt),
    updated_at: updatedAt,
    next_updated: formatter.format(nextUpdatedAt),
    next_updated_at: nextUpdatedAt,
    rates
  }
}

async function fetchRates(currency: string): Promise<ExchangeRateData> {
  const response = await fetch(`${API_URL}/${encodeURIComponent(currency)}`, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`汇率上游返回 HTTP ${response.status}`)
  }
  const text = await readLimitedResponseText(
    response,
    MAX_RESPONSE_BYTES,
    '汇率上游响应过大'
  )
  try {
    return normalizeExchangeRateResponse(JSON.parse(text) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('汇率上游返回了无效 JSON')
    throw error
  }
}

export async function getExchangeRates(currency: string): Promise<ExchangeRateData> {
  const existing = cache.get(currency)
  if (existing && existing.expiresAt > Date.now()) return existing.data
  let request = pending.get(currency)
  if (!request) {
    request = fetchRates(currency).then((data) => {
      if (cache.size >= 32 && !cache.has(currency)) {
        cache.delete(cache.keys().next().value as string)
      }
      cache.set(currency, { data, expiresAt: Date.now() + CACHE_TTL_MS })
      return data
    }).finally(() => pending.delete(currency))
    pending.set(currency, request)
  }
  return await request
}

export function clearExchangeRateCache(): void {
  cache.clear()
  pending.clear()
}

export function formatExchangeRateText(data: ExchangeRateData): string {
  const rates = data.rates.slice(0, 20)
    .map(item => `${item.currency} => ${item.rate}`).join('\n')
  return `${data.updated.slice(0, 10)} 的 ${data.base_code} 汇率\n\n${rates}`
}

export function formatExchangeRateMarkdown(data: ExchangeRateData): string {
  const rows = data.rates.slice(0, 30)
    .map(item => `| **${item.currency}** | ${item.rate.toFixed(4)} |`)
    .join('\n')
  return `# ${data.base_code} 汇率\n\n> 更新时间: ${data.updated}\n\n| 货币 | 汇率 |\n|------|------|\n${rows}\n\n*下次更新: ${data.next_updated}*`
}
