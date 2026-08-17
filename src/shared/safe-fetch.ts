import { lookup } from 'node:dns/promises'
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici'
import { BlockList, isIP, type LookupFunction } from 'node:net'

const blockedAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8], ['2001:db8::', 32]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])
type ResolvedAddress = { address: string, family: number }
type SafeRequestInit = Omit<RequestInit, 'signal'> & {
  signal?: AbortSignal | undefined
}
export interface SafeFetchOptions extends SafeRequestInit {
  allowedHosts: readonly string[]
  maxRedirects?: number
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
    .replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function isHostnameWithin(hostname: string, allowedHost: string): boolean {
  const value = normalizeHostname(hostname)
  const allowed = normalizeHostname(allowedHost)
  return value === allowed || value.endsWith(`.${allowed}`)
}

function assertPublicAddress(address: string): void {
  const family = isIP(address)
  if (!family || blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('upstream hostname resolved to a blocked network')
  }
}

async function assertSafeUrl(
  input: string | URL,
  allowedHosts: readonly string[],
  pinned: Map<string, ResolvedAddress[]>
): Promise<URL> {
  const url = input instanceof URL ? new URL(input) : new URL(input)
  if (url.protocol !== 'https:') throw new Error('upstream URL must use HTTPS')
  if (url.username || url.password) throw new Error('upstream URL credentials are not allowed')
  if (url.port && url.port !== '443') throw new Error('upstream URL port is not allowed')
  if (!allowedHosts.some(host => isHostnameWithin(url.hostname, host))) {
    throw new Error('upstream hostname is not allowed')
  }
  const hostname = normalizeHostname(url.hostname)
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) throw new Error('upstream hostname did not resolve')
  addresses.forEach(({ address }) => assertPublicAddress(address))
  pinned.set(hostname, addresses)
  return url
}

function createPinnedDispatcher(pinned: Map<string, ResolvedAddress[]>) {
  const pinnedLookup: LookupFunction = (hostname, options, callback) => {
    const addresses = pinned.get(normalizeHostname(hostname))
      ?.filter(item => !options.family || item.family === options.family) ?? []
    if (addresses.length === 0) {
      callback(new Error('upstream hostname has no verified address'), '', 0)
    } else if (options.all) {
      callback(null, addresses)
    } else {
      const selected = addresses[0]!
      callback(null, selected.address, selected.family)
    }
  }
  return new Agent({ connect: { lookup: pinnedLookup } })
}

function redirectedRequest(status: number, options: RequestInit): RequestInit {
  const method = (options.method || 'GET').toUpperCase()
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    const headers = new Headers(options.headers)
    headers.delete('content-length')
    headers.delete('content-type')
    return { ...options, method: 'GET', body: null, headers }
  }
  return options
}

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions
): Promise<Response> {
  const { allowedHosts, maxRedirects = 5, ...requestOptions } = options
  const pinned = new Map<string, ResolvedAddress[]>()
  let url = await assertSafeUrl(input, allowedHosts, pinned)
  let init: RequestInit = {
    ...requestOptions,
    redirect: 'manual',
    signal: requestOptions.signal ?? null
  }
  const dispatcher = createPinnedDispatcher(pinned)
  try {
    for (let count = 0; count <= maxRedirects; count += 1) {
      const response = await undiciFetch(url, {
        ...init,
        dispatcher
      } as unknown as UndiciRequestInit)
      if (!REDIRECTS.has(response.status)) return response as unknown as Response
      const location = response.headers.get('location')
      if (!location) return response as unknown as Response
      if (count === maxRedirects) {
        await response.body?.cancel()
        throw new Error('upstream redirect limit exceeded')
      }
      const next = await assertSafeUrl(new URL(location, url), allowedHosts, pinned)
      await response.body?.cancel()
      init = redirectedRequest(response.status, init)
      url = next
    }
    throw new Error('upstream redirect limit exceeded')
  } finally {
    void dispatcher.close()
  }
}
