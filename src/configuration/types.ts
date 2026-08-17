import type { z } from '@hono/zod-openapi'
import type { ConfigurationDefinitionSchema } from './definition-schema.js'

type ConfigurationScalar = boolean | number | string
export type ConfigurationValue = ConfigurationScalar | string[]
export type ConfigurationValues = Record<string, ConfigurationValue>

export type ServiceConfigurationDefinition = z.infer<
  typeof ConfigurationDefinitionSchema
>
export type ConfigurationGroup = ServiceConfigurationDefinition['groups'][number]
export type ConfigurationField = ConfigurationGroup['fields'][number]

export interface PersistedConfigurationSnapshot {
  schemaVersion: 1
  serviceId: string
  schemaSha256: string
  revision: number
  configurationSha256: string
  values: ConfigurationValues
  updatedAt: string | null
}

export type ConfigurationSnapshot = PersistedConfigurationSnapshot

interface RedactedSecretValue {
  configured: boolean
}

type RedactedConfigurationValue =
  | ConfigurationValue
  | RedactedSecretValue

export interface RedactedConfigurationState {
  schemaVersion: 1
  serviceId: string
  schemaSha256: string
  revision: number
  configurationSha256: string
  values: Record<string, RedactedConfigurationValue>
  updatedAt: string | null
}

export interface ConfigurationSnapshotStore {
  load(): Promise<PersistedConfigurationSnapshot | null>
  save(snapshot: PersistedConfigurationSnapshot): Promise<void>
}
