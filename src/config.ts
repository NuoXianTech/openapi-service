import { join, resolve } from 'node:path'
import { z } from 'zod'
import { buildInfo, type BuildInfo } from './build-info.js'

const READ_HEADER_TIMEOUT_MS = 5_000
const REQUEST_TIMEOUT_MS = 20_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const MAX_REQUEST_BODY_BYTES = 1024 * 1024
const CONFIGURATION_KEY_BYTES = 32

function parseConfigurationKey(value: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, 'hex')
  }
  if (/^[A-Za-z0-9_-]+$/.test(value)) {
    const decoded = Buffer.from(value, 'base64url')
    if (decoded.length === CONFIGURATION_KEY_BYTES) return decoded
  }
  const utf8 = Buffer.from(value, 'utf8')
  if (utf8.length === CONFIGURATION_KEY_BYTES) return utf8
  throw new Error(
    `SERVICE_CONFIG_KEY must be ${CONFIGURATION_KEY_BYTES} bytes (hex / base64url / utf-8)`
  )
}

const configurationKeySchema = z.string().trim().min(1).transform(
  (value, context) => {
    try {
      return parseConfigurationKey(value)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'invalid configuration key'
      })
      return z.NEVER
    }
  }
)

const environmentSchema = z.object({
  LISTEN_ADDR: z.string().trim().min(1).default(':8080'),
  API_SERVICE_TOKEN: z.string().trim().min(32),
  SERVICE_CONFIG_KEY: configurationKeySchema,
  SERVICE_DATA_DIR: z.string().trim().min(1).default('data'),
  SERVICE_ID: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
    .default('openapi-service'),
  SERVICE_NAME: z.string().trim().min(1).max(160).default('OpenAPI Service'),
  SERVICE_VERSION: z.string().trim().min(1).optional(),
  SERVICE_COMMIT: z.string().trim().min(1).optional()
})

export interface ServiceConfig {
  hostname: string
  port: number
  serviceToken: string
  configurationKey: Buffer
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
  environment: NodeJS.ProcessEnv = process.env,
  metadata: BuildInfo = buildInfo
): ServiceConfig {
  const parsed = environmentSchema.parse(environment)
  const listenAddress = parseListenAddress(parsed.LISTEN_ADDR)
  const dataDirectory = resolve(parsed.SERVICE_DATA_DIR)

  return {
    ...listenAddress,
    serviceToken: parsed.API_SERVICE_TOKEN,
    configurationKey: parsed.SERVICE_CONFIG_KEY,
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
    serviceId: parsed.SERVICE_ID,
    serviceName: parsed.SERVICE_NAME,
    version: parsed.SERVICE_VERSION
      ?? metadata.version
      ?? (environment.npm_package_version?.trim() || 'dev'),
    commit: parsed.SERVICE_COMMIT ?? metadata.commit ?? 'unknown'
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
