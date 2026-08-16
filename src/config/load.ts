import { environmentSchema } from './schema.js'

export interface ServiceConfig {
  hostname: string
  port: number
  serviceToken: string
  previousToken?: string
  readHeaderTimeoutMs: number
  requestTimeoutMs: number
  shutdownTimeoutMs: number
  maxRequestBodyBytes: number
  ipDatabaseDirectory: string
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

  return {
    ...listenAddress,
    serviceToken: parsed.API_SERVICE_TOKEN,
    ...(parsed.API_SERVICE_PREVIOUS_TOKEN
      ? { previousToken: parsed.API_SERVICE_PREVIOUS_TOKEN }
      : {}),
    readHeaderTimeoutMs: parseDuration(
      'READ_HEADER_TIMEOUT',
      parsed.READ_HEADER_TIMEOUT
    ),
    requestTimeoutMs: parseDuration(
      'REQUEST_TIMEOUT',
      parsed.REQUEST_TIMEOUT
    ),
    shutdownTimeoutMs: parseDuration(
      'SHUTDOWN_TIMEOUT',
      parsed.SHUTDOWN_TIMEOUT
    ),
    maxRequestBodyBytes: parsed.MAX_REQUEST_BODY_BYTES,
    ipDatabaseDirectory: parsed.IP_DATABASE_DIRECTORY,
    configurationFile: parsed.SERVICE_CONFIG_FILE,
    serviceId: parsed.SERVICE_ID,
    serviceName: parsed.SERVICE_NAME,
    version: parsed.SERVICE_VERSION,
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

function parseDuration(name: string, value: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(value)
  if (!match) {
    throw new Error(
      name + ' must be a positive duration such as 500ms, 5s, or 1m'
    )
  }

  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1
  const milliseconds = amount * multiplier

  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(name + ' must be a positive safe duration')
  }
  return milliseconds
}
