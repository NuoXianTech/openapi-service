import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes
} from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type {
  ConfigurationSnapshotStore,
  PersistedConfigurationSnapshot
} from './types.js'

const FILE_VERSION = 1
const encryptedFileSchema = z.object({
  version: z.literal(FILE_VERSION),
  serviceId: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  ciphertext: z.string().min(1)
})

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  serviceId: z.string().min(1),
  schemaSha256: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().nonnegative(),
  configurationSha256: z.string().regex(/^[0-9a-f]{64}$/),
  values: z.record(
    z.string(),
    z.union([
      z.boolean(),
      z.number(),
      z.string(),
      z.array(z.string())
    ])
  ),
  updatedAt: z.string().nullable()
})

export interface EncryptedConfigurationFileStoreOptions {
  filePath: string
  serviceId: string
  configurationKey: Buffer
}

export class EncryptedConfigurationFileStore
implements ConfigurationSnapshotStore {
  readonly #filePath: string
  readonly #serviceId: string
  readonly #configurationKey: Buffer

  constructor(options: EncryptedConfigurationFileStoreOptions) {
    if (options.configurationKey.length !== 32) {
      throw new Error('configuration encryption key must be 32 bytes')
    }
    this.#filePath = options.filePath
    this.#serviceId = options.serviceId
    this.#configurationKey = Buffer.from(options.configurationKey)
  }

  async load(): Promise<PersistedConfigurationSnapshot | null> {
    let raw: string
    try {
      raw = await readFile(this.#filePath, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null
      throw error
    }

    const envelope = encryptedFileSchema.parse(JSON.parse(raw))
    if (envelope.serviceId !== this.#serviceId) {
      throw new Error('configuration file service identity mismatch')
    }

    try {
      const plaintext = decryptPayload(envelope, this.#configurationKey)
      return snapshotSchema.parse(JSON.parse(plaintext))
    } catch (error) {
      throw new Error('configuration file could not be decrypted', {
        cause: error
      })
    }
  }

  async save(snapshot: PersistedConfigurationSnapshot): Promise<void> {
    const envelope = encryptPayload(
      JSON.stringify(snapshot),
      this.#serviceId,
      this.#configurationKey
    )
    const directory = dirname(this.#filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.#filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify(envelope),
        { encoding: 'utf8', mode: 0o600, flag: 'wx' }
      )
      await rename(temporaryPath, this.#filePath)
      await chmod(this.#filePath, 0o600).catch(() => undefined)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

function deriveConfigurationKey(key: Buffer): Buffer {
  return createHmac('sha256', key)
    .update('openapi-service:configuration-file:v1')
    .digest()
}

function encryptPayload(
  plaintext: string,
  serviceId: string,
  configurationKey: Buffer
) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(
    'aes-256-gcm',
    deriveConfigurationKey(configurationKey),
    iv
  )
  cipher.setAAD(Buffer.from(serviceId, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  return {
    version: FILE_VERSION,
    serviceId,
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url')
  }
}

function decryptPayload(
  envelope: z.infer<typeof encryptedFileSchema>,
  configurationKey: Buffer
): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveConfigurationKey(configurationKey),
    Buffer.from(envelope.iv, 'base64url')
  )
  decipher.setAAD(Buffer.from(envelope.serviceId, 'utf8'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
