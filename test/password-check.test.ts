import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import {
  checkPasswordStrength,
  countPasswordCodePoints,
  formatPasswordCheckMarkdown,
  formatPasswordCheckText,
  parsePasswordCheckBody
} from '../src/modules/password-check/service.js'
import type { Logger } from '../src/shared/logger.js'

const token = 'password-check-token-at-least-32-characters'
const headers = {
  authorization: `Service ${token}`,
  'content-type': 'application/json'
}
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'password-check-test', serviceName: 'Password Check Test',
  version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

describe('password check module', () => {
  it('rates a mixed password without returning its plaintext', () => {
    const password = 'N7!vK2@qP9#xR4$z'
    const result = checkPasswordStrength(password)
    expect(result).toMatchObject({
      length: 16,
      strength: '极强',
      character_analysis: {
        has_lowercase: true, has_uppercase: true,
        has_numbers: true, has_symbols: true,
        has_repeated: false, has_sequential: false,
        is_common_password: false
      }
    })
    expect(result.score).toBeGreaterThanOrEqual(85)
    expect(JSON.stringify(result)).not.toContain(password)
    expect(result).not.toHaveProperty('password')
  })

  it('penalizes common, repeated and sequential passwords', () => {
    const common = checkPasswordStrength('password')
    const patterned = checkPasswordStrength('abc111')
    expect(common.strength).toBe('极弱')
    expect(common.recommendations).toContain('不要使用已知的常见密码')
    expect(patterned.character_analysis.has_sequential).toBe(true)
    expect(patterned.character_analysis.has_repeated).toBe(true)
    expect(patterned.score).toBeLessThan(30)
  })

  it('counts Unicode code points without trimming or normalization', () => {
    const password = '密码🔐A1!'
    expect(password.length).toBe(7)
    expect(countPasswordCodePoints(password)).toBe(6)
    expect(checkPasswordStrength(password).length).toBe(6)
    expect(parsePasswordCheckBody({ password: '  ' }))
      .toEqual({ ok: true, password: '  ' })
  })

  it('validates body shape and the 128-code-point limit', () => {
    const maximum = '🔐'.repeat(128)
    expect(parsePasswordCheckBody(null))
      .toMatchObject({ ok: false, code: 'INVALID_REQUEST_BODY' })
    expect(parsePasswordCheckBody({ password: '' }))
      .toMatchObject({ ok: false, code: 'PASSWORD_REQUIRED' })
    expect(parsePasswordCheckBody({ password: maximum })).toMatchObject({ ok: true })
    expect(parsePasswordCheckBody({ password: `${maximum}🔐` }))
      .toMatchObject({ ok: false, code: 'PASSWORD_TOO_LONG' })
  })

  it('formats text and Markdown without the checked password', () => {
    const password = 'Never-Echo-This-2026!'
    const result = checkPasswordStrength(password)
    expect(formatPasswordCheckText(result)).toContain('密码强度检测')
    expect(formatPasswordCheckMarkdown(result)).toContain('# 密码强度检测')
    expect(formatPasswordCheckText(result)).not.toContain(password)
  })

  it('serves JSON and Markdown and rejects invalid encodings', async () => {
    const app = createApp({ config, logger })
    const body = JSON.stringify({ password: 'Example-Only-2026!' })
    const json = await app.request('/v1/password/check', {
      method: 'POST', headers, body
    })
    const payload = await json.json() as {
      code: string, data: { score: number }, timestamp: number
    }
    expect(json.status).toBe(200)
    expect(json.headers.get('cache-control')).toBe('no-store')
    expect(payload.code).toBe('OK')
    expect(payload.data.score).toEqual(expect.any(Number))
    expect(payload.timestamp).toEqual(expect.any(Number))
    expect(JSON.stringify(payload)).not.toContain('Example-Only-2026!')

    const markdown = await app.request('/v1/password/check?encode=md', {
      method: 'POST', headers, body
    })
    expect(markdown.headers.get('content-type')).toContain('text/markdown')
    expect(await markdown.text()).toContain('# 密码强度检测')

    const invalid = await app.request('/v1/password/check?encode=html', {
      method: 'POST', headers, body
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_ENCODING' })
  })

  it('rejects oversized bodies before analysis', async () => {
    const app = createApp({ config, logger })
    const response = await app.request('/v1/password/check', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'x'.repeat(33 * 1024) })
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      code: 'REQUEST_BODY_TOO_LARGE', data: null
    })
  })
})
