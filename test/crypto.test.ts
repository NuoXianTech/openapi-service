import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { ServiceConfigurationManager } from '../src/configuration/manager.js'
import { ensureCryptoAlgorithmsRegistered } from '../src/modules/crypto/index.js'
import {
  getCryptoAlgorithm,
  listCryptoAlgorithms,
  normalizeCryptoOptions
} from '../src/modules/crypto/registry.js'
import {
  parseCryptoRequestBody,
  toCryptoMode
} from '../src/modules/crypto/request.js'
import { serviceConfigurationDefinition } from '../src/modules/index.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'crypto-test-token-that-is-at-least-32-characters'
const authorization = { authorization: `Service ${serviceToken}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken,
  configurationKey: Buffer.alloc(32, 1),
  readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000,
  maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data',
  assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'crypto-test-service',
  serviceName: 'Crypto Test Service',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

ensureCryptoAlgorithmsRegistered()

async function roundTrip(
  name: string,
  input: string,
  rawOptions: Record<string, unknown> = {}
) {
  const algorithm = getCryptoAlgorithm(name)
  expect(algorithm).not.toBeNull()
  const encrypted = await algorithm!.exec({
    mode: 'encrypt',
    text: input,
    options: normalizeCryptoOptions(
      algorithm!.options,
      'encrypt',
      rawOptions
    )
  })
  const decrypted = await algorithm!.exec({
    mode: 'decrypt',
    text: encrypted.text,
    options: normalizeCryptoOptions(
      algorithm!.options,
      'decrypt',
      rawOptions
    )
  })
  expect(decrypted.text).toBe(input)
}

describe('crypto module', () => {
  it('parses the unified body and rejects legacy root parameters', () => {
    expect(parseCryptoRequestBody({
      algorithm: 'caesar',
      action: 'encode',
      input: 'Hello',
      options: { shift: 3 }
    })).toMatchObject({ ok: true })
    expect(parseCryptoRequestBody({
      algorithm: 'caesar',
      action: 'encode',
      input: 'Hello',
      shift: 3
    })).toMatchObject({ ok: false, code: 'UNSUPPORTED_PARAMETER' })
    expect(parseCryptoRequestBody({
      algorithm: 'rc4',
      action: 'encode',
      input: 'Hello',
      options: { key: 'wrong-location' }
    })).toMatchObject({ ok: false, code: 'UNSUPPORTED_PARAMETER' })
    expect(toCryptoMode('encode')).toBe('encrypt')
    expect(toCryptoMode('decode')).toBe('decrypt')
  })

  it('registers the complete algorithm catalog', () => {
    expect(listCryptoAlgorithms().map(algorithm => algorithm.name)).toEqual([
      'base64',
      'beast',
      'buddha',
      'caesar',
      'core-values',
      'emoji-aes',
      'morse',
      'rc4',
      'taiji'
    ])
  })

  it('round-trips every migrated algorithm', async () => {
    await roundTrip('base64', '你好 OpenAPI')
    await roundTrip('beast', '你好 OpenAPI')
    await roundTrip('buddha', '你好 OpenAPI')
    await roundTrip('caesar', 'Hello OpenAPI 123', { shift: 7 })
    await roundTrip('core-values', '你好 OpenAPI')
    await roundTrip('emoji-aes', '你好 OpenAPI', {
      key: 'test-secret',
      rotation: 9
    })
    await roundTrip('morse', 'HELLO OPENAPI 123')
    await roundTrip('rc4', '你好 OpenAPI', { key: 'test-secret' })
    await roundTrip('rc4', '你好 OpenAPI', {
      key: 'test-secret',
      format: 'raw',
      keyEncoding: 'utf8',
      cipherEncoding: 'hex'
    })
    await roundTrip('taiji', '你好 OpenAPI', { key: 'test-secret' })
  })

  it('rejects unknown options and missing required keys', () => {
    const caesar = getCryptoAlgorithm('caesar')!
    expect(() => normalizeCryptoOptions(
      caesar.options,
      'encrypt',
      { shfit: 3 }
    )).toThrow('当前算法不支持参数 options.shfit')
    const rc4 = getCryptoAlgorithm('rc4')!
    expect(() => normalizeCryptoOptions(rc4.options, 'encrypt', {}))
      .toThrow('缺少必填参数：key')
  })

  it('lists and executes algorithms with the standard response envelope', async () => {
    const app = createApp({ config, logger })
    const listResponse = await app.request('/v1/crypto', {
      headers: authorization
    })
    const list = await listResponse.json() as {
      code: string
      data: { items: Array<{ algorithm: string }> }
      timestamp: number
    }
    expect(listResponse.status).toBe(200)
    expect(list.code).toBe('OK')
    expect(list.data.items).toHaveLength(9)
    expect(list.timestamp).toEqual(expect.any(Number))

    const executeResponse = await app.request('/v1/crypto', {
      method: 'POST',
      headers: {
        ...authorization,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        algorithm: 'base64',
        action: 'encode',
        input: 'Hello'
      })
    })
    const executed = await executeResponse.json() as {
      code: string
      message: string
      data: { result: string }
      timestamp: number
    }
    expect(executeResponse.status).toBe(200)
    expect(executed).toMatchObject({
      code: 'OK',
      message: '处理成功',
      data: { result: 'SGVsbG8=' }
    })
    expect(executed.timestamp).toEqual(expect.any(Number))
  })

  it('hides and rejects algorithms disabled through Service configuration', async () => {
    const configuration = new ServiceConfigurationManager({
      serviceId: config.serviceId,
      definition: serviceConfigurationDefinition,
      initialValues: { 'crypto.allowedAlgorithms': ['base64'] }
    })
    const app = createApp({ config, logger, configuration })
    const listResponse = await app.request('/v1/crypto', {
      headers: authorization
    })
    const list = await listResponse.json() as {
      data: { items: Array<{ algorithm: string }> }
    }
    expect(list.data.items.map(item => item.algorithm)).toEqual(['base64'])

    const response = await app.request('/v1/crypto', {
      method: 'POST',
      headers: {
        ...authorization,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        algorithm: 'caesar',
        action: 'encode',
        input: 'Hello'
      })
    })
    const body = await response.json() as { code: string, data: null }
    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      code: 'CRYPTO_ALGORITHM_DISABLED',
      data: null
    })
  })

  it('returns explicit errors for malformed, unknown, and invalid calls', async () => {
    const app = createApp({ config, logger })
    const call = (body: unknown) => app.request('/v1/crypto', {
      method: 'POST',
      headers: {
        ...authorization,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const malformed = await call({ algorithm: 'base64', action: 'encode' })
    expect(malformed.status).toBe(400)
    expect((await malformed.json() as { code: string }).code)
      .toBe('INVALID_PARAMETER')

    const unknown = await call({
      algorithm: 'unknown',
      action: 'encode',
      input: 'Hello'
    })
    expect(unknown.status).toBe(404)

    const invalid = await call({
      algorithm: 'base64',
      action: 'decode',
      input: 'not-valid!'
    })
    expect(invalid.status).toBe(422)
    expect((await invalid.json() as { code: string }).code)
      .toBe('CRYPTO_FAILED')
  })
})
