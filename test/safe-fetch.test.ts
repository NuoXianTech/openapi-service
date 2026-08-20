import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLimitedBuffer, readLimitedText } from '../src/shared/limited-response.js'
import {
  isHostnameWithin,
  safeFetch
} from '../src/shared/safe-fetch.js'

type PinnedLookup = (
  hostname: string,
  options: { family?: number, all?: boolean },
  callback: (
    error: Error | null,
    address: string | Array<{ address: string, family: number }>,
    family?: number
  ) => void
) => void
const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  pinnedLookup: undefined as PinnedLookup | undefined
}))

vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect?: { lookup?: PinnedLookup } }) {
      mocks.pinnedLookup = options.connect?.lookup
    }
    close() { return Promise.resolve() }
  },
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
}))

beforeEach(() => {
  mocks.pinnedLookup = undefined
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => vi.restoreAllMocks())

describe('safe fetch', () => {
  it('matches only an allowed hostname or its subdomains', () => {
    expect(isHostnameWithin('example.com', 'example.com')).toBe(true)
    expect(isHostnameWithin('api.example.com', 'example.com')).toBe(true)
    expect(isHostnameWithin('API.EXAMPLE.COM.', 'example.com')).toBe(true)
    expect(isHostnameWithin('example.com.evil.test', 'example.com')).toBe(false)
    expect(isHostnameWithin('notexample.com', 'example.com')).toBe(false)
  })

  it('rejects non-HTTPS, private, and loopback destinations', async () => {
    await expect(safeFetch('http://example.com/resource', {
      allowedHosts: ['example.com']
    })).rejects.toThrow('must use HTTPS')
    mocks.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(safeFetch('https://example.com/resource', {
      allowedHosts: ['example.com']
    })).rejects.toThrow('blocked network')
    mocks.lookup.mockResolvedValueOnce([{ address: '::ffff:7f00:1', family: 6 }])
    await expect(safeFetch('https://example.com/resource', {
      allowedHosts: ['example.com']
    })).rejects.toThrow('blocked network')
  })

  it('pins verified DNS addresses for the connection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => {
        const lookup = mocks.pinnedLookup
        expect(lookup).toBeTypeOf('function')
        const resolved = await new Promise<{ address: string, family: number }>(
          (resolve, reject) => lookup?.('example.com', {}, (
            error, address, family
          ) => {
            if (error) reject(error)
            else if (typeof address === 'string' && family) {
              resolve({ address, family })
            }
          })
        )
        expect(resolved).toEqual({ address: '93.184.216.34', family: 4 })
        return new Response('ok')
      }
    )
    await expect(safeFetch('https://example.com/resource', {
      allowedHosts: ['example.com']
    })).resolves.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('removes credentials when a redirect crosses origins', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.example.net/resource' }
      }))
      .mockResolvedValueOnce(new Response('ok'))

    await safeFetch('https://example.com/resource', {
      allowedHosts: ['example.com', 'example.net'],
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'proxy-authorization': 'Basic secret',
        'x-request-id': 'request-id'
      }
    })

    const redirected = fetchMock.mock.calls[1]
    expect(redirected?.[0].toString()).toBe('https://cdn.example.net/resource')
    const headers = new Headers(redirected?.[1]?.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('proxy-authorization')).toBe(false)
    expect(headers.get('x-request-id')).toBe('request-id')
  })

  it('rejects response bodies over the configured byte limit', async () => {
    await expect(readLimitedText(new Response('12345'), 4))
      .rejects.toThrow('response is too large')
  })

  it('preserves raw bytes while reading a limited binary response', async () => {
    const bytes = Uint8Array.from([0, 255, 128, 13, 10])
    await expect(readLimitedBuffer(new Response(bytes), bytes.byteLength))
      .resolves.toEqual(Buffer.from(bytes))
  })

  it('rejects a binary response over the limit from content length', async () => {
    const response = new Response(Uint8Array.from([1, 2, 3]), {
      headers: { 'content-length': '3' }
    })
    await expect(readLimitedBuffer(response, 2))
      .rejects.toThrow('response is too large')
  })

  it('rejects a binary response when streamed chunks exceed the limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]))
        controller.enqueue(Uint8Array.from([3]))
        controller.close()
      }
    })
    await expect(readLimitedBuffer(new Response(stream), 2))
      .rejects.toThrow('response is too large')
  })
})
