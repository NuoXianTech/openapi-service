import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import { serviceConfigurationDefinition } from '../src/modules/index.js'
import { EncryptedConfigurationFileStore } from '../src/configuration/file-store.js'
import { ServiceConfigurationManager } from '../src/configuration/manager.js'
import type {
  ConfigurationSnapshotStore,
  PersistedConfigurationSnapshot,
  ServiceConfigurationDefinition
} from '../src/configuration/types.js'
import { ConfigurationDefinitionSchema } from '../src/contracts/configuration.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'configuration-token-that-is-at-least-32-characters'
const differentServiceToken =
  'different-configuration-token-that-is-at-least-32-characters'
const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken,
  readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000,
  maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data',
  assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'configuration-test-service',
  serviceName: 'Configuration Test Service',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const authorization = {
  authorization: `Service ${serviceToken}`
}
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

describe('service configuration protocol', () => {
  it('accepts camelCase field segments and rejects ambiguous definitions', () => {
    expect(ConfigurationDefinitionSchema.safeParse(
      serviceConfigurationDefinition
    ).success).toBe(true)

    const duplicate = structuredClone(serviceConfigurationDefinition) as
      ServiceConfigurationDefinition
    duplicate.groups[0]!.fields.push(
      structuredClone(duplicate.groups[0]!.fields[0]!)
    )
    expect(() => new ServiceConfigurationManager({
      serviceId: config.serviceId,
      definition: duplicate
    })).toThrow(/duplicate configuration field/)
  })

  it('exposes a declarative schema and never reads a secret back', async () => {
    const app = createApp({ config, logger })
    const schemaResponse = await app.request(
      '/.well-known/configuration-schema.json',
      { headers: authorization }
    )
    const schema = await schemaResponse.json() as {
      groups: Array<{
        fields: Array<{ key: string, type: string }>
      }>
    }
    const stateResponse = await app.request(
      '/.well-known/configuration.json',
      { headers: authorization }
    )
    const stateText = await stateResponse.text()
    const state = JSON.parse(stateText) as {
      revision: number
      values: Record<string, unknown>
    }

    expect(schemaResponse.status).toBe(200)
    expect(schemaResponse.headers.get(
      'x-configuration-schema-sha256'
    )).toMatch(/^[0-9a-f]{64}$/)
    expect(schema.groups.flatMap(group => group.fields)).toContainEqual(
      expect.objectContaining({ key: 'ip.databaseKey', type: 'secret' })
    )
    expect(stateResponse.status).toBe(200)
    expect(state.revision).toBe(0)
    expect(state.values['ip.databaseKey']).toEqual({ configured: false })
  })

  it('applies full revisions idempotently and rejects conflicting reuse', async () => {
    const app = createApp({ config, logger })
    const body = {
      schemaVersion: 1,
      revision: 1,
      values: {
        'ip.enabled': false,
        'ip.databaseKey': 'new-secret-value'
      }
    }
    const first = await app.request('/.well-known/configuration.json', {
      method: 'PUT',
      headers: {
        ...authorization,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const firstResult = await first.json() as {
      revision: number
      configurationSha256: string
    }
    const repeated = await app.request(
      '/.well-known/configuration.json',
      {
        method: 'PUT',
        headers: {
          ...authorization,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )
    const conflict = await app.request(
      '/.well-known/configuration.json',
      {
        method: 'PUT',
        headers: {
          ...authorization,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          ...body,
          values: { ...body.values, 'ip.enabled': true }
        })
      }
    )

    expect(first.status).toBe(200)
    expect(firstResult.revision).toBe(1)
    expect(firstResult.configurationSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(repeated.status).toBe(200)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      code: 'CONFIGURATION_REVISION_CONFLICT',
      data: { currentRevision: 1 }
    })
  })

  it('serializes concurrent revisions so an older save cannot overwrite a newer one', async () => {
    let releaseFirstSave: (() => void) | undefined
    const firstSaveBlocked = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })
    const savedRevisions: number[] = []
    const store: ConfigurationSnapshotStore = {
      async load() {
        return null
      },
      async save(snapshot: PersistedConfigurationSnapshot) {
        savedRevisions.push(snapshot.revision)
        if (snapshot.revision === 1) await firstSaveBlocked
      }
    }
    const manager = new ServiceConfigurationManager({
      serviceId: config.serviceId,
      definition: serviceConfigurationDefinition,
      store
    })

    const first = manager.apply(1, {
      'ip.enabled': true,
      'ip.databaseKey': 'revision-one'
    })
    await vi.waitFor(() => expect(savedRevisions).toEqual([1]))
    const second = manager.apply(2, {
      'ip.enabled': false,
      'ip.databaseKey': 'revision-two'
    })

    expect(savedRevisions).toEqual([1])
    releaseFirstSave?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({ revision: 2 })
    ])
    expect(savedRevisions).toEqual([1, 2])
    expect(manager.getSnapshot()).toMatchObject({
      revision: 2,
      values: {
        'ip.enabled': false,
        'ip.databaseKey': 'revision-two'
      }
    })
  })

  it('encrypts the local runtime snapshot and restores it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openapi-config-'))
    tempDirectories.push(directory)
    const filePath = join(directory, 'service-configuration.enc')
    const createManager = () => new ServiceConfigurationManager({
      serviceId: config.serviceId,
      definition: serviceConfigurationDefinition,
      store: new EncryptedConfigurationFileStore({
        filePath,
        serviceId: config.serviceId,
        token: serviceToken
      })
    })
    const first = createManager()
    await first.apply(3, {
      'ip.enabled': true,
      'ip.databaseKey': 'persisted-secret-value'
    })
    const file = await readFile(filePath, 'utf8')
    const restored = createManager()
    await restored.initialize()

    expect(file).not.toContain('persisted-secret-value')
    expect(restored.getSnapshot()).toMatchObject({
      revision: 3,
      values: {
        'ip.enabled': true,
        'ip.databaseKey': 'persisted-secret-value'
      }
    })
  })

  it('rejects a snapshot encrypted with another Service Token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openapi-config-token-'))
    tempDirectories.push(directory)
    const filePath = join(directory, 'service-configuration.enc')
    const snapshot = {
      schemaVersion: 1 as const,
      serviceId: config.serviceId,
      schemaSha256: 'a'.repeat(64),
      revision: 4,
      configurationSha256: 'b'.repeat(64),
      values: { 'ip.enabled': true },
      updatedAt: new Date().toISOString()
    }

    await new EncryptedConfigurationFileStore({
      filePath,
      serviceId: config.serviceId,
      token: serviceToken
    }).save(snapshot)

    await expect(new EncryptedConfigurationFileStore({
      filePath,
      serviceId: config.serviceId,
      token: differentServiceToken
    }).load()).rejects.toThrow('configuration file could not be decrypted')
  })
})
