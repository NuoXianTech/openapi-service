import type {
  ConfigurationField,
  ConfigurationValue,
  ConfigurationValues,
  ServiceConfigurationDefinition
} from './types.js'

export class ConfigurationValidationError extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message)
    this.name = 'ConfigurationValidationError'
  }
}

function configurationFields(
  definition: ServiceConfigurationDefinition
): ConfigurationField[] {
  return definition.groups.flatMap((group) => group.fields)
}

export function assertConfigurationDefinition(
  definition: ServiceConfigurationDefinition
): void {
  const groupKeys = new Set<string>()
  const fieldKeys = new Set<string>()

  for (const group of definition.groups) {
    if (groupKeys.has(group.key)) {
      throw new ConfigurationValidationError(
        group.key,
        `duplicate configuration group: ${group.key}`
      )
    }
    groupKeys.add(group.key)

    for (const field of group.fields) {
      if (fieldKeys.has(field.key)) {
        throw new ConfigurationValidationError(
          field.key,
          `duplicate configuration field: ${field.key}`
        )
      }
      fieldKeys.add(field.key)

      if (
        (field.type === 'text'
          || field.type === 'textarea'
          || field.type === 'secret')
        && field.minLength !== undefined
        && field.maxLength !== undefined
        && field.minLength > field.maxLength
      ) {
        throw new ConfigurationValidationError(
          field.key,
          `${field.key} has minLength greater than maxLength`
        )
      }
      if (
        field.type === 'number'
        && field.minimum !== undefined
        && field.maximum !== undefined
        && field.minimum > field.maximum
      ) {
        throw new ConfigurationValidationError(
          field.key,
          `${field.key} has minimum greater than maximum`
        )
      }
      if (field.type === 'single-select' || field.type === 'multi-select') {
        const optionValues = new Set<string>()
        for (const option of field.options) {
          if (optionValues.has(option.value)) {
            throw new ConfigurationValidationError(
              field.key,
              `${field.key} contains duplicate option value: ${option.value}`
            )
          }
          optionValues.add(option.value)
        }
      }
    }
  }
}

export function secretConfigurationKeys(
  definition: ServiceConfigurationDefinition
): Set<string> {
  return new Set(
    configurationFields(definition)
      .filter((field) => field.type === 'secret')
      .map((field) => field.key)
  )
}

function defaultConfigurationValues(
  definition: ServiceConfigurationDefinition
): ConfigurationValues {
  return Object.fromEntries(
    configurationFields(definition).map((field) => [
      field.key,
      field.type === 'secret' ? '' : structuredClone(field.default)
    ])
  )
}

export function normalizeConfigurationValues(
  definition: ServiceConfigurationDefinition,
  input: Record<string, unknown>,
  options: {
    allowIncomplete?: boolean
    allowUnknown?: boolean
    baseValues?: ConfigurationValues
  } = {}
): ConfigurationValues {
  const fields = configurationFields(definition)
  const knownKeys = new Set(fields.map((field) => field.key))
  if (!options.allowUnknown) {
    const unknownKey = Object.keys(input).find((key) => !knownKeys.has(key))
    if (unknownKey) {
      throw new ConfigurationValidationError(
        unknownKey,
        `unknown configuration field: ${unknownKey}`
      )
    }
  }

  const defaults = defaultConfigurationValues(definition)
  const baseValues = options.baseValues ?? defaults
  const normalized: ConfigurationValues = {}
  for (const field of fields) {
    const value = Object.hasOwn(input, field.key)
      ? input[field.key]
      : baseValues[field.key] ?? defaults[field.key]
    normalized[field.key] = normalizeFieldValue(
      field,
      value,
      options.allowIncomplete === true
    )
  }
  return normalized
}

function normalizeFieldValue(
  field: ConfigurationField,
  value: unknown,
  allowIncomplete: boolean
): ConfigurationValue {
  switch (field.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw invalidType(field, 'boolean')
      return value
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw invalidType(field, 'finite number')
      }
      if (field.minimum !== undefined && value < field.minimum) {
        throw invalidValue(field, `must be at least ${field.minimum}`)
      }
      if (field.maximum !== undefined && value > field.maximum) {
        throw invalidValue(field, `must be at most ${field.maximum}`)
      }
      if (field.step !== undefined) {
        const origin = field.minimum ?? 0
        const steps = (value - origin) / field.step
        if (Math.abs(steps - Math.round(steps)) > Number.EPSILON * 16) {
          throw invalidValue(field, `must use step ${field.step}`)
        }
      }
      return value
    }
    case 'text':
    case 'textarea':
    case 'secret':
      return normalizeText(field, value, allowIncomplete)
    case 'single-select': {
      if (typeof value !== 'string') throw invalidType(field, 'string')
      if (!field.options.some((option) => option.value === value)) {
        throw invalidValue(field, 'contains an unsupported option')
      }
      return value
    }
    case 'multi-select': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw invalidType(field, 'string array')
      }
      const allowed = new Set(field.options.map((option) => option.value))
      const unique = Array.from(new Set(value as string[]))
      if (unique.some((item) => !allowed.has(item))) {
        throw invalidValue(field, 'contains an unsupported option')
      }
      if (field.required && unique.length === 0 && !allowIncomplete) {
        throw invalidValue(field, 'is required')
      }
      return unique
    }
  }
}

function normalizeText(
  field: Extract<ConfigurationField, { type: 'text' | 'textarea' | 'secret' }>,
  value: unknown,
  allowIncomplete: boolean
): string {
  if (typeof value !== 'string') throw invalidType(field, 'string')
  if (value.length === 0 && allowIncomplete) return value
  if (field.required && value.length === 0) {
    throw invalidValue(field, 'is required')
  }
  if (field.minLength !== undefined && value.length < field.minLength) {
    throw invalidValue(field, `must contain at least ${field.minLength} characters`)
  }
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    throw invalidValue(field, `must contain at most ${field.maxLength} characters`)
  }
  return value
}

function invalidType(field: ConfigurationField, expected: string) {
  return new ConfigurationValidationError(
    field.key,
    `${field.key} must be a ${expected}`
  )
}

function invalidValue(field: ConfigurationField, message: string) {
  return new ConfigurationValidationError(
    field.key,
    `${field.key} ${message}`
  )
}
