import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/load.js'

const currentToken = 'current-token-that-is-at-least-32-characters'

describe('loadConfig', () => {
  it('parses the Compose listen address and durations', () => {
    const config = loadConfig({
      LISTEN_ADDR: ':8080',
      API_SERVICE_TOKEN: currentToken,
      READ_HEADER_TIMEOUT: '5s',
      SHUTDOWN_TIMEOUT: '10s'
    })

    expect(config.hostname).toBe('0.0.0.0')
    expect(config.port).toBe(8080)
    expect(config.readHeaderTimeoutMs).toBe(5_000)
    expect(config.requestTimeoutMs).toBe(20_000)
    expect(config.shutdownTimeoutMs).toBe(10_000)
    expect(config.maxRequestBodyBytes).toBe(1024 * 1024)
    expect(config.ipDatabaseDirectory).toBe('data/ip')
    expect(config.serviceId).toBe('openapi-service')
    expect(config.serviceName).toBe('OpenAPI Service')
    expect(config.configurationFile).toBe(
      'data/runtime/service-configuration.enc'
    )
  })

  it('rejects a missing service token', () => {
    expect(() => loadConfig({ LISTEN_ADDR: ':8080' })).toThrow()
  })

  it('rejects using the same current and previous token', () => {
    expect(() =>
      loadConfig({
        LISTEN_ADDR: ':8080',
        API_SERVICE_TOKEN: currentToken,
        API_SERVICE_PREVIOUS_TOKEN: currentToken
      })
    ).toThrow('must differ from API_SERVICE_TOKEN')
  })

  it('loads the local IP database directory without accepting business secrets', () => {
    const config = loadConfig({
      API_SERVICE_TOKEN: currentToken,
      IP_DATABASE_DIRECTORY: 'fixtures/ip'
    })

    expect(config.ipDatabaseDirectory).toBe('fixtures/ip')
  })
})
