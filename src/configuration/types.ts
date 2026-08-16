type ConfigurationScalar = boolean | number | string
export type ConfigurationValue = ConfigurationScalar | string[]
export type ConfigurationValues = Record<string, ConfigurationValue>

interface ConfigurationOption {
  label: string
  value: string
  description?: string
}

interface ConfigurationFieldBase {
  key: string
  label: string
  description?: string
  required?: boolean
}

interface BooleanConfigurationField extends ConfigurationFieldBase {
  type: 'boolean'
  default: boolean
}

interface TextConfigurationField extends ConfigurationFieldBase {
  type: 'text' | 'textarea'
  default: string
  placeholder?: string
  minLength?: number
  maxLength?: number
}

interface SecretConfigurationField extends ConfigurationFieldBase {
  type: 'secret'
  placeholder?: string
  minLength?: number
  maxLength?: number
}

interface NumberConfigurationField extends ConfigurationFieldBase {
  type: 'number'
  default: number
  minimum?: number
  maximum?: number
  step?: number
}

interface SingleSelectConfigurationField extends ConfigurationFieldBase {
  type: 'single-select'
  default: string
  options: ConfigurationOption[]
}

interface MultiSelectConfigurationField extends ConfigurationFieldBase {
  type: 'multi-select'
  default: string[]
  options: ConfigurationOption[]
}

export type ConfigurationField =
  | BooleanConfigurationField
  | TextConfigurationField
  | SecretConfigurationField
  | NumberConfigurationField
  | SingleSelectConfigurationField
  | MultiSelectConfigurationField

export interface ConfigurationGroup {
  key: string
  label: string
  description?: string
  fields: ConfigurationField[]
}

export interface ServiceConfigurationDefinition {
  schemaVersion: 1
  groups: ConfigurationGroup[]
}

export interface PersistedConfigurationSnapshot {
  schemaVersion: 1
  serviceId: string
  schemaSha256: string
  revision: number
  configurationSha256: string
  values: ConfigurationValues
  updatedAt: string | null
}

export interface ConfigurationSnapshot
  extends PersistedConfigurationSnapshot {}

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
