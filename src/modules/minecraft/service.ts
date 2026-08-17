import { AsyncCache } from '../../shared/async-cache.js'
import { readLimitedText } from '../../shared/limited-response.js'

const PROFILE_HOST = 'api.mojang.com'
const SESSION_HOST = 'sessionserver.mojang.com'
const TEXTURE_HOST = 'textures.minecraft.net'
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 256
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_TEXTURE_PROPERTY_LENGTH = 64 * 1024
const USERNAME = /^[a-z0-9_]{3,16}$/i
const UUID = /^[a-f0-9]{32}$/i
const DASHED_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

type ErrorKind = 'input' | 'business' | 'upstream'
type UnknownRecord = Record<string, unknown>
export type MinecraftOutputType = 'json' | 'skin' | 'cape'
export interface MinecraftProfileData {
  name: string
  uuid: string
  texture_timestamp: number
  skin: { url: string, model: 'classic' | 'slim' } | null
  cape: { url: string } | null
}
export interface MinecraftFailure {
  status: 400 | 404 | 502
  code: string
  message: string
  business: boolean
}

class MinecraftError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly status: 400 | 404 | 502,
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) { super(message, options) }
}
function failure(
  kind: ErrorKind,
  status: 400 | 404 | 502,
  code: string,
  message: string,
  options?: ErrorOptions
) { return new MinecraftError(kind, status, code, message, options) }
function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
function normalizeUuid(value: unknown): string | null {
  const normalized = string(value).replaceAll('-', '').toLowerCase()
  return UUID.test(normalized) ? normalized : null
}

export function normalizeMinecraftIdentifier(value: string): string | null {
  const identifier = value.trim()
  if (USERNAME.test(identifier)) return identifier
  return UUID.test(identifier) || DASHED_UUID.test(identifier)
    ? identifier.replaceAll('-', '').toLowerCase()
    : null
}
export function parseMinecraftOutputType(value: string): MinecraftOutputType | null {
  const type = value.trim().toLowerCase()
  if (!type || type === 'json') return 'json'
  if (type === 'skin' || type === 'skin_url') return 'skin'
  if (type === 'cape' || type === 'skin_cloak') return 'cape'
  return null
}

function textureUrl(value: unknown): string | null {
  const raw = string(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)
      || url.hostname !== TEXTURE_HOST || url.username || url.password || url.port) {
      throw new Error('unsafe texture URL')
    }
    url.protocol = 'https:'
    return url.toString()
  } catch (error) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang 返回了无效的纹理地址', { cause: error })
  }
}

async function fetchJson(url: URL, source: string): Promise<{
  status: number
  payload: unknown
}> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'OpenAPI/Minecraft' },
      redirect: 'error', signal: AbortSignal.timeout(10_000)
    })
  } catch (error) {
    throw failure('upstream', 502, 'UPSTREAM_ERROR', `请求 ${source} 失败`, { cause: error })
  }
  let body: string
  try {
    body = await readLimitedText(
      response, MAX_RESPONSE_BYTES, `${source} 返回内容无效或过大`
    )
  } catch (error) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', `${source} 返回内容无效或过大`, { cause: error })
  }
  let payload: unknown = null
  if (response.ok && body) {
    try { payload = JSON.parse(body) as unknown } catch (error) {
      throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', `${source} 返回了无效 JSON`, { cause: error })
    }
  }
  return { status: response.status, payload }
}

async function resolveUuid(username: string): Promise<string> {
  const url = new URL(`https://${PROFILE_HOST}/users/profiles/minecraft/${encodeURIComponent(username)}`)
  const result = await fetchJson(url, 'Mojang Profile API')
  if (result.status === 204 || result.status === 404) {
    throw failure('business', 404, 'PLAYER_NOT_FOUND', '未找到该 Minecraft Java 版玩家')
  }
  if (result.status < 200 || result.status >= 300) {
    throw failure('upstream', 502, 'UPSTREAM_ERROR', `Mojang Profile API 返回 HTTP ${result.status}`)
  }
  const uuid = isRecord(result.payload) ? normalizeUuid(result.payload.id) : null
  if (!uuid) throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang Profile API 返回了无效玩家资料')
  return uuid
}

function decodeTextures(value: string): UnknownRecord {
  if (!value || value.length > MAX_TEXTURE_PROPERTY_LENGTH) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang 返回了无效纹理属性')
  }
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown
    if (!isRecord(payload)) throw new Error('invalid texture payload')
    return payload
  } catch (error) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang 返回了无效纹理属性', { cause: error })
  }
}

function normalizeSession(payload: unknown, expectedUuid: string): MinecraftProfileData {
  if (!isRecord(payload) || !Array.isArray(payload.properties)) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang Session Server 返回了无效玩家资料')
  }
  const uuid = normalizeUuid(payload.id)
  const name = string(payload.name)
  const property = payload.properties.find(item => (
    isRecord(item) && item.name === 'textures' && typeof item.value === 'string'
  ))
  if (!uuid || uuid !== expectedUuid || !USERNAME.test(name) || !isRecord(property)) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang Session Server 返回了无效玩家资料')
  }
  const decoded = decodeTextures(string(property.value))
  const timestamp = Number(decoded.timestamp)
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !isRecord(decoded.textures)) {
    throw failure('upstream', 502, 'UPSTREAM_INVALID_RESPONSE', 'Mojang 返回了无效纹理数据')
  }
  const skin = isRecord(decoded.textures.SKIN) ? decoded.textures.SKIN : null
  const cape = isRecord(decoded.textures.CAPE) ? decoded.textures.CAPE : null
  const skinUrl = skin ? textureUrl(skin.url) : null
  const capeUrl = cape ? textureUrl(cape.url) : null
  const metadata = skin && isRecord(skin.metadata) ? skin.metadata : null
  return {
    name, uuid, texture_timestamp: timestamp,
    skin: skinUrl ? {
      url: skinUrl,
      model: metadata?.model === 'slim' ? 'slim' : 'classic'
    } : null,
    cape: capeUrl ? { url: capeUrl } : null
  }
}

async function fetchProfile(identifier: string): Promise<MinecraftProfileData> {
  const uuid = UUID.test(identifier)
    ? identifier.toLowerCase()
    : await resolveUuid(identifier)
  const url = new URL(`https://${SESSION_HOST}/session/minecraft/profile/${uuid}`)
  url.searchParams.set('unsigned', 'true')
  const result = await fetchJson(url, 'Mojang Session Server')
  if (result.status === 204 || result.status === 404) {
    throw failure('business', 404, 'PLAYER_NOT_FOUND', '未找到该 Minecraft Java 版玩家')
  }
  if (result.status < 200 || result.status >= 300) {
    throw failure('upstream', 502, 'UPSTREAM_ERROR', `Mojang Session Server 返回 HTTP ${result.status}`)
  }
  return normalizeSession(result.payload, uuid)
}

const cache = new AsyncCache<string, MinecraftProfileData>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: MAX_CACHE_ENTRIES
})
export async function getMinecraftProfile(
  identifier: string,
  signal?: AbortSignal
): Promise<MinecraftProfileData> {
  const key = identifier.toLowerCase()
  const profile = await cache.get(
    key,
    () => fetchProfile(identifier),
    { signal }
  )
  return structuredClone(profile)
}
export function clearMinecraftCache(): void {
  cache.clear()
}
export function classifyMinecraftError(error: unknown): MinecraftFailure {
  return error instanceof MinecraftError
    ? { status: error.status, code: error.code, message: error.message,
        business: error.kind !== 'input' }
    : { status: 502, code: 'UPSTREAM_ERROR',
        message: '获取 Minecraft 玩家资料失败', business: true }
}
export function createMinecraftInputError(
  code: 'MISSING_ID' | 'INVALID_ID' | 'INVALID_TYPE'
): Error {
  const messages = {
    MISSING_ID: '缺少参数 id',
    INVALID_ID: 'id 必须是 Minecraft Java 版用户名或 UUID',
    INVALID_TYPE: 'type 仅支持 json、skin 或 cape'
  }
  return failure('input', 400, code, messages[code])
}
