import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  formatPasswordGeneratorMarkdown,
  generatePassword,
  parsePasswordGeneratorMode,
  parsePasswordLength
} from '../src/modules/password-generator/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'password-generator-token-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'password-generator-test', serviceName: 'Password Generator Test',
  version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

describe('password generator module', () => {
  it('guarantees every character type in strong mode', () => {
    const result = generatePassword({ length: 32, mode: 'strong' })
    const minimum = generatePassword({ length: 4, mode: 'strong' })
    for (const password of [result.password, minimum.password]) {
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[2-9]/)
      expect(password).toMatch(/[!@#$%^&*_+=?-]/)
      expect(password).not.toMatch(/[01iIlLoO]/)
    }
    expect(result).toMatchObject({
      length: 32, mode: 'strong',
      character_types: ['lowercase', 'uppercase', 'numbers', 'symbols'],
      ambiguous_characters_excluded: true, strength: '极强'
    })
  })

  it('supports alphanumeric and numeric modes', () => {
    const alpha = generatePassword({ length: 12, mode: 'alphanumeric' })
    const numeric = generatePassword({ length: 8, mode: 'numeric' })
    expect(alpha.password).toMatch(/^[A-HJ-KM-NP-Za-hj-km-np-z2-9]+$/)
    expect(numeric.password).toMatch(/^[2-9]{8}$/)
    expect(numeric.character_types).toEqual(['numbers'])
  })

  it('validates complete integer lengths and modes', () => {
    expect(parsePasswordLength('')).toBe(16)
    expect(parsePasswordLength('4')).toBe(4)
    expect(parsePasswordLength('128')).toBe(128)
    expect(parsePasswordLength('16px')).toBeNull()
    expect(parsePasswordLength('1e2')).toBeNull()
    expect(parsePasswordGeneratorMode('ALPHANUMERIC')).toBe('alphanumeric')
    expect(parsePasswordGeneratorMode('custom')).toBeNull()
  })

  it('rejects invalid direct generation options', () => {
    expect(() => generatePassword({ length: 3, mode: 'strong' }))
      .toThrow('4-128')
    expect(() => generatePassword({ length: 16, mode: 'custom' as never }))
      .toThrow('mode')
  })

  it('serves standard JSON, text, and Markdown responses', async () => {
    const app = createApp({ config, logger })
    const json = await app.request(
      '/v1/password?length=24&mode=alphanumeric', { headers }
    )
    const payload = await json.json() as {
      code: string, data: { password: string, length: number }, timestamp: number
    }
    expect(json.status).toBe(200)
    expect(json.headers.get('cache-control')).toBe('no-store')
    expect(payload.code).toBe('OK')
    expect(payload.data.password).toHaveLength(24)
    expect(payload.timestamp).toEqual(expect.any(Number))

    const text = await app.request('/v1/password?encode=text', { headers })
    expect(await text.text()).toHaveLength(16)
    const markdown = await app.request('/v1/password?encoding=md', { headers })
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(formatPasswordGeneratorMarkdown(generatePassword({
      length: 16, mode: 'strong'
    }))).toContain('# 随机密码')
  })

  it('returns stable errors for invalid query values', async () => {
    const app = createApp({ config, logger })
    const length = await app.request('/v1/password?length=3', { headers })
    expect(await length.json()).toMatchObject({ code: 'INVALID_LENGTH' })
    const mode = await app.request('/v1/password?mode=custom', { headers })
    expect(await mode.json()).toMatchObject({ code: 'INVALID_MODE' })
    const encoding = await app.request('/v1/password?encode=html', { headers })
    expect(await encoding.json()).toMatchObject({ code: 'INVALID_ENCODING' })
  })
})
