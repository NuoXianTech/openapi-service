import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLimitedText } from '../src/shared/limited-response.js'
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

  it('rejects response bodies over the configured byte limit', async () => {
    await expect(readLimitedText(new Response('12345'), 4))
      .rejects.toThrow('response is too large')
  })
})
