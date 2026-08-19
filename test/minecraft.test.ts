import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  classifyMinecraftError,
  clearMinecraftCache,
  getMinecraftProfile,
  normalizeMinecraftIdentifier,
  parseMinecraftOutputType
} from '../src/modules/minecraft/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'minecraft-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  configurationKey: Buffer.alloc(32, 1),
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'minecraft-test',
  serviceName: 'Minecraft Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const UUID = '069a79f444e94726a5befca90e38aaf5'

function session(options: { cape?: boolean, host?: string } = {}) {
  const textures = {
    timestamp: 1786100000000,
    textures: {
      SKIN: { url: `${options.host ?? 'http://textures.minecraft.net'}/texture/skin`, metadata: { model: 'slim' } },
      ...(options.cape ? { CAPE: { url: 'https://textures.minecraft.net/texture/cape' } } : {})
    }
  }
  return new Response(JSON.stringify({
    id: UUID, name: 'Notch', properties: [{
      name: 'textures', value: Buffer.from(JSON.stringify(textures)).toString('base64')
    }]
  }))
}

afterEach(() => {
  clearMinecraftCache()
  vi.unstubAllGlobals()
})

describe('minecraft module', () => {
  it('normalizes identifiers and compatibility output aliases', () => {
    expect(normalizeMinecraftIdentifier(' Notch ')).toBe('Notch')
    expect(normalizeMinecraftIdentifier('069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBe(UUID)
    expect(normalizeMinecraftIdentifier('bad name')).toBeNull()
    expect(parseMinecraftOutputType('skin_url')).toBe('skin')
    expect(parseMinecraftOutputType('skin_cloak')).toBe('cape')
    expect(parseMinecraftOutputType('image')).toBeNull()
  })

  it('combines username lookup and session data and caches the result', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: UUID, name: 'Notch' })))
      .mockResolvedValueOnce(session({ cape: true }))
    vi.stubGlobal('fetch', request)
    const first = await getMinecraftProfile('Notch')
    first.name = 'changed'
    const cached = await getMinecraftProfile('Notch')
    expect(cached).toMatchObject({
      name: 'Notch', uuid: UUID,
      skin: { url: 'https://textures.minecraft.net/texture/skin', model: 'slim' },
      cape: { url: 'https://textures.minecraft.net/texture/cape' }
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('maps missing players and rejects foreign texture hosts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 404 })
    ))
    let missing: unknown
    try { await getMinecraftProfile('MissingPlayer') } catch (error) { missing = error }
    expect(classifyMinecraftError(missing)).toMatchObject({
      status: 404, code: 'PLAYER_NOT_FOUND'
    })

    clearMinecraftCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(session({ host: 'https://example.com' })))
    await expect(getMinecraftProfile(UUID)).rejects.toMatchObject({
      code: 'UPSTREAM_INVALID_RESPONSE'
    })
  })

  it('serves JSON and validated texture redirects through Hono', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(session({ cape: true })))
    const app = createApp({ config, logger })
    const response = await app.request(`/v1/minecraft?id=${UUID}`, { headers })
    const body = await response.json() as { code: string, data: { uuid: string } }
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', data: { uuid: UUID } })
    const skin = await app.request(`/v1/minecraft?id=${UUID}&type=skin`, { headers })
    expect(skin.status).toBe(302)
    expect(skin.headers.get('location')).toBe('https://textures.minecraft.net/texture/skin')
    expect((await app.request('/v1/minecraft', { headers })).status).toBe(400)
  })
})
