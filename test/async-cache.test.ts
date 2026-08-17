import { describe, expect, it, vi } from 'vitest'
import { AsyncCache } from '../src/shared/async-cache.js'

function deferred<TValue>() {
  let resolve!: (value: TValue) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('AsyncCache', () => {
  it('deduplicates concurrent loads and reuses the cached value', async () => {
    const pending = deferred<number>()
    const load = vi.fn(() => pending.promise)
    const cache = new AsyncCache<string, number>({ ttlMs: 1_000 })

    const first = cache.get('key', load)
    const second = cache.get('key', load)
    expect(load).toHaveBeenCalledTimes(1)

    pending.resolve(42)
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42])
    await expect(cache.get('key', load)).resolves.toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not let a cleared in-flight load repopulate the cache', async () => {
    const pending = deferred<number>()
    const cache = new AsyncCache<string, number>({ ttlMs: 1_000 })
    const first = cache.get('key', () => pending.promise)

    cache.clear()
    pending.resolve(1)
    await expect(first).resolves.toBe(1)
    await expect(cache.get('key', async () => 2)).resolves.toBe(2)
  })

  it('aborts one waiter without cancelling the shared load', async () => {
    const pending = deferred<number>()
    const cache = new AsyncCache<string, number>({ ttlMs: 1_000 })
    const controller = new AbortController()

    const aborted = cache.get('key', () => pending.promise, {
      signal: controller.signal
    })
    const completed = cache.get('key', () => pending.promise)
    controller.abort(new Error('request cancelled'))

    await expect(aborted).rejects.toThrow('request cancelled')
    pending.resolve(7)
    await expect(completed).resolves.toBe(7)
    await expect(cache.get('key', async () => 8)).resolves.toBe(7)
  })

  it('reloads values after their TTL expires', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const cache = new AsyncCache<string, number>({ ttlMs: 100 })
      let value = 1

      await expect(cache.get('key', async () => value)).resolves.toBe(1)
      value = 2
      vi.setSystemTime(1_101)
      await expect(cache.get('key', async () => value)).resolves.toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
