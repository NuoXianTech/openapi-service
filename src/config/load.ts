import { join, resolve } from 'node:path'
import { environmentSchema } from './schema.js'

const SERVICE_ID = 'openapi-service'
const SERVICE_NAME = 'OpenAPI Service'
const READ_HEADER_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 20_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const MAX_REQUEST_BODY_BYTES = 1024 * 1024

export interface ServiceConfig {
  hostname: string
  port: number
  serviceToken: string
  readHeaderTimeoutMs: number
  requestTimeoutMs: number
  shutdownTimeoutMs: number
  maxRequestBodyBytes: number
  dataDirectory: string
  assetsDirectory: string
  configurationFile: string
  serviceId: string
  serviceName: string
  version: string
  commit: string
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): ServiceConfig {
  const parsed = environmentSchema.parse(environment)
  const listenAddress = parseListenAddress(parsed.LISTEN_ADDR)
  const dataDirectory = resolve(parsed.SERVICE_DATA_DIR)

  return {
    ...listenAddress,
    serviceToken: parsed.API_SERVICE_TOKEN,
    readHeaderTimeoutMs: READ_HEADER_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    dataDirectory,
    assetsDirectory: join(dataDirectory, 'assets'),
    configurationFile: join(
      dataDirectory,
      'runtime',
      'service-configuration.enc'
    ),
    serviceId: SERVICE_ID,
    serviceName: SERVICE_NAME,
    version: parsed.SERVICE_VERSION
      ?? (environment.npm_package_version?.trim() || 'dev'),
    commit: parsed.SERVICE_COMMIT
  }
}

function parseListenAddress(value: string): {
  hostname: string
  port: number
} {
  if (/^\d+$/.test(value)) {
    return { hostname: '0.0.0.0', port: parsePort(value) }
  }

  const ipv6Match = /^\[([^\]]+)\]:(\d+)$/.exec(value)
  if (ipv6Match) {
    return {
      hostname: ipv6Match[1] ?? '::',
      port: parsePort(ipv6Match[2] ?? '')
    }
  }

  const separator = value.lastIndexOf(':')
  if (separator < 0) {
    throw new Error('LISTEN_ADDR must use host:port, [ipv6]:port, or port')
  }

  return {
    hostname: value.slice(0, separator) || '0.0.0.0',
    port: parsePort(value.slice(separator + 1))
  }
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('LISTEN_ADDR port must be an integer from 1 to 65535')
  }
  return port
}
