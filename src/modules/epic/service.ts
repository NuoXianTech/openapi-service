import { readLimitedResponseText } from '../../shared/limited-response.js'

const API_URL = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN'
const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_GAMES = 50
const formatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
})

export interface EpicFreeGame {
  id: string
  title: string
  cover: string
  original_price: number
  original_price_desc: string
  description: string
  seller: string
  is_free_now: boolean
  free_start: string
  free_start_at: number
  free_end: string
  free_end_at: number
  link: string
}

interface RecordValue { [key: string]: unknown }
interface PromotionWindow { startAt: number, endAt: number }
interface CacheEntry { expiresAt: number, games: EpicFreeGame[] }

let cache: CacheEntry | null = null
let pending: Promise<EpicFreeGame[]> | null = null

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
}

function normalizeText(value: unknown, fallback = ''): string {
  return readString(value).replace(/\s+/g, ' ').trim() || fallback
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function readPromotionWindows(value: unknown): PromotionWindow[] {
  if (!isRecord(value)) return []
  const seen = new Set<string>()
  return [value.promotionalOffers, value.upcomingPromotionalOffers]
    .flatMap((groups) => Array.isArray(groups) ? groups : [])
    .flatMap((group) => (
      isRecord(group) && Array.isArray(group.promotionalOffers)
        ? group.promotionalOffers
        : []
    ))
    .flatMap((offer) => {
      if (!isRecord(offer) || !isRecord(offer.discountSetting)) return []
      if (readNumber(offer.discountSetting.discountPercentage) !== 0) return []
      const startAt = Date.parse(readString(offer.startDate))
      const endAt = Date.parse(readString(offer.endDate))
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
        return []
      }
      const identity = `${startAt}:${endAt}`
      if (seen.has(identity)) return []
      seen.add(identity)
      return [{ startAt, endAt }]
    })
    .toSorted((first, second) => first.startAt - second.startAt)
}

function selectPromotion(value: unknown, now: number): PromotionWindow | null {
  const windows = readPromotionWindows(value)
  return windows.find(window => window.startAt <= now && now < window.endAt)
    ?? windows.find(window => window.startAt > now)
    ?? null
}

function readMappingSlug(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (isRecord(item) && readString(item.pageSlug)) {
      return readString(item.pageSlug)
    }
  }
  return ''
}

function createGameLink(game: RecordValue): string {
  const catalog = isRecord(game.catalogNs) ? game.catalogNs : {}
  const slug = readString(game.productSlug)
    || readMappingSlug(catalog.mappings)
    || readMappingSlug(game.offerMappings)
    || readString(game.urlSlug)
  const segments = slug.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  return segments.length === 0
    ? ''
    : `https://store.epicgames.com/zh-CN/p/${segments.map(encodeURIComponent).join('/')}`
}

function normalizeHttpsUrl(value: unknown): string {
  try {
    const wrapper = new URL(readString(value))
    const url = new URL(wrapper.searchParams.get('cover') || wrapper.toString())
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.port) return ''
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return ''
  }
}

function readCover(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const images = value.filter(isRecord)
  const wide = images.find(image => readString(image.type) === 'OfferImageWide')
  for (const image of wide ? [wide, ...images] : images) {
    const cover = normalizeHttpsUrl(image.url)
    if (cover) return cover
  }
  return ''
}

function readPrice(game: RecordValue): { value: number, description: string } {
  const price = isRecord(game.price) ? game.price : {}
  const total = isRecord(price.totalPrice) ? price.totalPrice : {}
  const currency = isRecord(total.currencyInfo) ? total.currencyInfo : {}
  const formatted = isRecord(total.fmtPrice) ? total.fmtPrice : {}
  const rawPrice = readNumber(total.originalPrice)
  const rawDecimals = readNumber(currency.decimals)
  const decimals = rawDecimals !== null && Number.isInteger(rawDecimals)
    && rawDecimals >= 0 && rawDecimals <= 4 ? rawDecimals : 2
  return {
    value: rawPrice !== null && rawPrice >= 0
      ? rawPrice / (10 ** decimals)
      : 0,
    description: readString(formatted.originalPrice) || '暂无价格'
  }
}

function normalizeGame(value: unknown, now: number): EpicFreeGame | null {
  if (!isRecord(value)) return null
  const offerType = readString(value.offerType).toUpperCase()
  if (!['BASE_GAME', 'OTHERS'].includes(offerType)) return null
  const promotion = selectPromotion(value.promotions, now)
  const title = normalizeText(value.title).replaceAll('Mystery Game', '神秘游戏')
  if (!promotion || !title) return null
  const price = readPrice(value)
  return {
    id: readString(value.id),
    title,
    cover: readCover(value.keyImages),
    original_price: price.value,
    original_price_desc: price.description,
    description: normalizeText(value.description, '暂无描述')
      .replaceAll('Mystery Game', '神秘游戏'),
    seller: normalizeText(
      isRecord(value.seller) ? value.seller.name : '',
      '未知发行商'
    ),
    is_free_now: promotion.startAt <= now && now < promotion.endAt,
    free_start: formatter.format(promotion.startAt),
    free_start_at: promotion.startAt,
    free_end: formatter.format(promotion.endAt),
    free_end_at: promotion.endAt,
    link: createGameLink(value)
  }
}

export function normalizeEpicResponse(
  payload: unknown,
  now = Date.now()
): EpicFreeGame[] {
  const data = isRecord(payload) ? payload.data : null
  const catalog = isRecord(data) ? data.Catalog : null
  const store = isRecord(catalog) ? catalog.searchStore : null
  const elements = isRecord(store) ? store.elements : null
  if (!Array.isArray(elements)) {
    throw new Error('Epic 上游返回了无效游戏数据')
  }
  return elements.flatMap((game) => {
    const normalized = normalizeGame(game, now)
    return normalized ? [normalized] : []
  }).toSorted(sortGames).slice(0, MAX_GAMES)
}

function sortGames(first: EpicFreeGame, second: EpicFreeGame): number {
  return Number(second.is_free_now) - Number(first.is_free_now)
    || first.free_start_at - second.free_start_at
    || first.title.localeCompare(second.title, 'zh-CN')
}

async function fetchGames(signal?: AbortSignal): Promise<EpicFreeGame[]> {
  let response: Response
  try {
    response = await fetch(API_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 Chrome/124 Safari/537.36'
      },
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(15_000)
    })
  } catch (error) {
    throw new Error('Epic 上游请求失败', { cause: error })
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Epic 上游返回 HTTP ${response.status}`)
  }
  try {
    const text = await readLimitedResponseText(
      response,
      MAX_RESPONSE_BYTES,
      'Epic 上游响应过大'
    )
    return normalizeEpicResponse(JSON.parse(text) as unknown)
  } catch (error) {
    throw new Error('Epic 上游返回了无效 JSON 数据', { cause: error })
  }
}

export async function getEpicFreeGames(
  signal?: AbortSignal
): Promise<EpicFreeGame[]> {
  const now = Date.now()
  if (!cache || cache.expiresAt <= now) {
    pending ??= fetchGames(signal).then((games) => {
      cache = { games, expiresAt: Date.now() + CACHE_TTL_MS }
      return games
    }).finally(() => { pending = null })
    await pending
  }
  return (cache?.games ?? [])
    .filter(game => game.free_end_at > now)
    .map(game => ({
      ...game,
      is_free_now: game.free_start_at <= now && now < game.free_end_at
    }))
    .toSorted(sortGames)
}

export function clearEpicCache(): void {
  cache = null
  pending = null
}

function title(value: string): string {
  return value.includes('《') ? value : `《${value}》`
}

function shortTime(timestamp: number): string {
  return formatter.format(timestamp).slice(0, 16)
}

export function formatEpicText(games: EpicFreeGame[]): string {
  if (games.length === 0) {
    return 'Epic Games 免费游戏\n\n暂无正在或即将免费的游戏'
  }
  const items = games.slice(0, 20).map((game, index) => {
    const period = game.is_free_now
      ? `现在免费，截至 ${shortTime(game.free_end_at)}`
      : `${shortTime(game.free_start_at)} 至 ${shortTime(game.free_end_at)} 免费`
    return `${index + 1}. ${title(game.title)}，${period}\n\n${game.description}`
  }).join('\n\n')
  return `Epic Games 免费游戏\n\n${items}`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!|<>])/g, '\\$1')
}

export function formatEpicMarkdown(games: EpicFreeGame[]): string {
  if (games.length === 0) {
    return '# Epic Games 免费游戏\n\n暂无正在或即将免费的游戏。'
  }
  const items = games.slice(0, 20).map((game, index) => {
    const escapedTitle = escapeMarkdown(title(game.title))
    const heading = game.link
      ? `[${escapedTitle}](<${game.link}>)`
      : escapedTitle
    const period = game.is_free_now
      ? `**现在免费**，截至 ${shortTime(game.free_end_at)}`
      : `${shortTime(game.free_start_at)} 至 ${shortTime(game.free_end_at)} 免费`
    const cover = game.cover
      ? `![${escapeMarkdown(game.title)}](<${game.cover}>)`
      : ''
    return [
      `## ${index + 1}. ${heading}`,
      '',
      period,
      '',
      escapeMarkdown(game.description),
      ...(cover ? ['', cover] : []),
      '',
      `**发行商**：${escapeMarkdown(game.seller)} · **原价**：${escapeMarkdown(game.original_price_desc)}`
    ].join('\n')
  }).join('\n\n---\n\n')
  return `# Epic Games 免费游戏\n\n${items}`
}
