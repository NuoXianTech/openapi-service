import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config/load.js'

const currentToken = 'current-token-that-is-at-least-32-characters'

describe('loadConfig', () => {
  it('parses the listen address and applies fixed runtime limits', () => {
    const config = loadConfig({
      LISTEN_ADDR: ':8080',
      API_SERVICE_TOKEN: currentToken
    })
    const dataDirectory = resolve('data')

    expect(config.hostname).toBe('0.0.0.0')
    expect(config.port).toBe(8080)
    expect(config.readHeaderTimeoutMs).toBe(5_000)
    expect(config.requestTimeoutMs).toBe(20_000)
    expect(config.shutdownTimeoutMs).toBe(10_000)
    expect(config.maxRequestBodyBytes).toBe(1024 * 1024)
    expect(config.dataDirectory).toBe(dataDirectory)
    expect(config.assetsDirectory).toBe(join(dataDirectory, 'assets'))
    expect(config.serviceId).toBe('openapi-service')
    expect(config.serviceName).toBe('OpenAPI Service')
    expect(config.version).toBe('dev')
    expect(config.configurationFile).toBe(
      join(dataDirectory, 'runtime', 'service-configuration.enc')
    )
  })

  it('rejects a missing service token', () => {
    expect(() => loadConfig({ LISTEN_ADDR: ':8080' })).toThrow()
  })

  it('derives every persistent path from SERVICE_DATA_DIR', () => {
    const config = loadConfig({
      API_SERVICE_TOKEN: currentToken,
      SERVICE_DATA_DIR: 'fixtures/service-data'
    })
    const dataDirectory = resolve('fixtures/service-data')

    expect(config.dataDirectory).toBe(dataDirectory)
    expect(config.assetsDirectory).toBe(join(dataDirectory, 'assets'))
    expect(config.configurationFile).toBe(
      join(dataDirectory, 'runtime', 'service-configuration.enc')
    )
  })

  it('accepts a deployment-defined stable identity and display name', () => {
    const config = loadConfig({
      API_SERVICE_TOKEN: currentToken,
      SERVICE_ID: 'example.weather-service',
      SERVICE_NAME: 'Example Weather Service'
    })

    expect(config.serviceId).toBe('example.weather-service')
    expect(config.serviceName).toBe('Example Weather Service')
  })

  it('rejects an invalid Service identity', () => {
    expect(() => loadConfig({
      API_SERVICE_TOKEN: currentToken,
      SERVICE_ID: 'Invalid Service ID'
    })).toThrow()
  })

  it('uses package metadata for a prebuilt pnpm start', () => {
    const config = loadConfig({
      API_SERVICE_TOKEN: currentToken,
      npm_package_version: '0.1.0'
    })

    expect(config.version).toBe('0.1.0')
  })
})
