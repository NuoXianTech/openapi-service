import { canonicalSha256 } from '../shared/canonical-json.js'
import type {
  ConfigurationSnapshot,
  ConfigurationSnapshotStore,
  ConfigurationValues,
  RedactedConfigurationState,
  ServiceConfigurationDefinition
} from './types.js'
import {
  assertConfigurationDefinition,
  normalizeConfigurationValues,
  secretConfigurationKeys
} from './values.js'

export class ConfigurationRevisionError extends Error {
  constructor(
    readonly currentRevision: number,
    message: string
  ) {
    super(message)
    this.name = 'ConfigurationRevisionError'
  }
}

export interface ServiceConfigurationManagerOptions {
  serviceId: string
  definition: ServiceConfigurationDefinition
  initialValues?: Record<string, unknown>
  store?: ConfigurationSnapshotStore
}

export class ServiceConfigurationManager {
  readonly #serviceId: string
  readonly #definition: ServiceConfigurationDefinition
  readonly #schemaSha256: string
  readonly #store: ConfigurationSnapshotStore | undefined
  readonly #secretKeys: Set<string>
  readonly #listeners = new Set<(
    current: ConfigurationSnapshot,
    previous: ConfigurationSnapshot
  ) => void>()
  #applyTail: Promise<void> = Promise.resolve()
  #snapshot: ConfigurationSnapshot

  constructor(options: ServiceConfigurationManagerOptions) {
    assertConfigurationDefinition(options.definition)
    this.#serviceId = options.serviceId
    this.#definition = structuredClone(options.definition)
    this.#schemaSha256 = canonicalSha256(this.#definition)
    this.#store = options.store
    this.#secretKeys = secretConfigurationKeys(this.#definition)
    const values = normalizeConfigurationValues(
      this.#definition,
      options.initialValues ?? {},
      { allowUnknown: true }
    )
    this.#snapshot = this.createSnapshot(0, values, null)
  }

  async initialize(): Promise<void> {
    const persisted = await this.#store?.load()
    if (!persisted) return
    if (persisted.serviceId !== this.#serviceId) {
      throw new Error('persisted configuration belongs to another service')
    }

    const values = normalizeConfigurationValues(
      this.#definition,
      persisted.values,
      { allowUnknown: true }
    )
    const snapshot = this.createSnapshot(
      persisted.revision,
      values,
      persisted.updatedAt
    )
    this.#snapshot = snapshot

    if (
      persisted.schemaSha256 !== snapshot.schemaSha256
      || persisted.configurationSha256 !== snapshot.configurationSha256
    ) {
      await this.#store?.save(snapshot)
    }
  }

  getDefinition(): ServiceConfigurationDefinition {
    return structuredClone(this.#definition)
  }

  getSchemaSha256(): string {
    return this.#schemaSha256
  }

  getSnapshot(): ConfigurationSnapshot {
    return structuredClone(this.#snapshot)
  }

  getValue<TValue extends ConfigurationValues[string]>(key: string): TValue {
    if (!Object.hasOwn(this.#snapshot.values, key)) {
      throw new Error(`unknown configuration field: ${key}`)
    }
    return structuredClone(this.#snapshot.values[key]) as TValue
  }

  getRedactedState(): RedactedConfigurationState {
    const snapshot = this.#snapshot
    return {
      schemaVersion: 1,
      serviceId: this.#serviceId,
      schemaSha256: this.#schemaSha256,
      revision: snapshot.revision,
      configurationSha256: snapshot.configurationSha256,
      values: Object.fromEntries(
        Object.entries(snapshot.values).map(([key, value]) => [
          key,
          this.#secretKeys.has(key)
            ? { configured: typeof value === 'string' && value.length > 0 }
            : structuredClone(value)
        ])
      ),
      updatedAt: snapshot.updatedAt
    }
  }

  subscribe(
    listener: (
      current: ConfigurationSnapshot,
      previous: ConfigurationSnapshot
    ) => void
  ): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async apply(
    revision: number,
    input: Record<string, unknown>
  ): Promise<ConfigurationSnapshot> {
    const values = structuredClone(input)
    const operation = this.#applyTail.then(() => (
      this.applySerially(revision, values)
    ))
    this.#applyTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async applySerially(
    revision: number,
    input: Record<string, unknown>
  ): Promise<ConfigurationSnapshot> {
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new ConfigurationRevisionError(
        this.#snapshot.revision,
        'configuration revision must be a positive safe integer'
      )
    }

    if (revision < this.#snapshot.revision) {
      throw new ConfigurationRevisionError(
        this.#snapshot.revision,
        'configuration revision is older than the active revision'
      )
    }
    const values = normalizeConfigurationValues(this.#definition, input)
    const next = this.createSnapshot(
      revision,
      values,
      new Date().toISOString()
    )
    if (revision === this.#snapshot.revision) {
      if (next.configurationSha256 === this.#snapshot.configurationSha256) {
        return this.getSnapshot()
      }
      throw new ConfigurationRevisionError(
        this.#snapshot.revision,
        'configuration revision already exists with different values'
      )
    }

    await this.#store?.save(next)
    const previous = this.#snapshot
    this.#snapshot = next
    for (const listener of this.#listeners) listener(next, previous)
    return this.getSnapshot()
  }

  private createSnapshot(
    revision: number,
    values: ConfigurationValues,
    updatedAt: string | null
  ): ConfigurationSnapshot {
    const configurationSha256 = canonicalSha256({
      schemaSha256: this.#schemaSha256,
      values
    })
    return {
      schemaVersion: 1,
      serviceId: this.#serviceId,
      schemaSha256: this.#schemaSha256,
      revision,
      configurationSha256,
      values: structuredClone(values),
      updatedAt
    }
  }
}
