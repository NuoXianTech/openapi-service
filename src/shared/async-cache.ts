import { waitForAbort } from './abort.js'

interface AsyncCacheOptions {
  ttlMs: number
  maxEntries?: number
}

interface AsyncCacheReadOptions {
  forceRefresh?: boolean
  signal?: AbortSignal | undefined
}

interface CacheEntry<TValue> {
  expiresAt: number
  value: TValue
}

/**
 * Small in-memory cache for idempotent upstream reads.
 *
 * Concurrent callers share one load, while aborting an individual request
 * only stops that caller from waiting. Clearing the cache also prevents an
 * older in-flight load from repopulating it after configuration changes.
 */
export class AsyncCache<TKey, TValue> {
  readonly #ttlMs: number
  readonly #maxEntries: number
  readonly #entries = new Map<TKey, CacheEntry<TValue>>()
  readonly #pending = new Map<TKey, Promise<TValue>>()
  #generation = 0

  constructor(options: AsyncCacheOptions) {
    this.#ttlMs = options.ttlMs
    this.#maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY
  }

  get(
    key: TKey,
    load: () => Promise<TValue>,
    options: AsyncCacheReadOptions = {}
  ): Promise<TValue> {
    if (options.forceRefresh) this.#entries.delete(key)

    const now = Date.now()
    const cached = this.#entries.get(key)
    if (cached && cached.expiresAt > now) {
      return waitForAbort(Promise.resolve(cached.value), options.signal)
    }
    if (cached) this.#entries.delete(key)

    let request = this.#pending.get(key)
    if (!request) {
      const generation = this.#generation
      request = load()
        .then((value) => {
          if (generation === this.#generation) {
            this.store(key, value)
          }
          return value
        })
        .finally(() => {
          if (this.#pending.get(key) === request) {
            this.#pending.delete(key)
          }
        })
      this.#pending.set(key, request)
    }

    return waitForAbort(request, options.signal)
  }

  clear(): void {
    this.#generation += 1
    this.#entries.clear()
    this.#pending.clear()
  }

  private store(key: TKey, value: TValue): void {
    if (!this.#entries.has(key)) {
      while (this.#entries.size >= this.#maxEntries) {
        const oldest = this.#entries.keys().next().value as TKey | undefined
        if (oldest === undefined) break
        this.#entries.delete(oldest)
      }
    } else {
      this.#entries.delete(key)
    }

    this.#entries.set(key, {
      expiresAt: Date.now() + this.#ttlMs,
      value
    })
  }
}
