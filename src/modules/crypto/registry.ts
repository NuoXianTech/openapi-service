import type {
  CryptoAlgorithm,
  CryptoMode,
  CryptoOptionDefinition
} from './types.js'
import { createCryptoBusinessError } from './types.js'

const registry = new Map<string, CryptoAlgorithm>()

function parameterName(name: string): string {
  return name === 'key' ? 'key' : `options.${name}`
}

export function registerCryptoAlgorithm(algorithm: CryptoAlgorithm): void {
  if (registry.has(algorithm.name)) {
    throw new Error(`Duplicate crypto algorithm: ${algorithm.name}`)
  }
  registry.set(algorithm.name, algorithm)
}

export function getCryptoAlgorithm(name: string): CryptoAlgorithm | null {
  return registry.get(name) ?? null
}

export function listCryptoAlgorithms(): CryptoAlgorithm[] {
  return Array.from(registry.values())
}

function coerce(
  value: unknown,
  definition: CryptoOptionDefinition
): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (definition.type === 'number') {
    const number = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(number)) {
      throw createCryptoBusinessError(
        `参数 ${parameterName(definition.name)} 不是合法数字`
      )
    }
    return number
  }
  if (definition.type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 1 || value === '1') return true
    if (value === 'false' || value === 0 || value === '0') return false
    throw createCryptoBusinessError(
      `参数 ${parameterName(definition.name)} 不是合法布尔值`
    )
  }
  return String(value)
}

export function normalizeCryptoOptions(
  definitions: CryptoOptionDefinition[] | undefined,
  mode: CryptoMode,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  const allowed = new Set(
    (definitions ?? []).map(definition => definition.name)
  )
  const unknownName = Object.keys(raw).find(name => !allowed.has(name))
  if (unknownName) {
    throw createCryptoBusinessError(
      `当前算法不支持参数 ${parameterName(unknownName)}`
    )
  }

  for (const definition of definitions ?? []) {
    if (definition.modes && !definition.modes.includes(mode)) continue
    const incoming = coerce(raw[definition.name], definition)
    const value = incoming === undefined ? definition.default : incoming
    if (value === undefined) {
      if (definition.required) {
        throw createCryptoBusinessError(
          `缺少必填参数：${parameterName(definition.name)}`
        )
      }
      continue
    }
    if (definition.type === 'number') {
      const number = value as number
      if (definition.min !== undefined && number < definition.min) {
        throw createCryptoBusinessError(
          `参数 ${parameterName(definition.name)} 不能小于 ${definition.min}`
        )
      }
      if (definition.max !== undefined && number > definition.max) {
        throw createCryptoBusinessError(
          `参数 ${parameterName(definition.name)} 不能大于 ${definition.max}`
        )
      }
    }
    if (
      definition.enum
      && !definition.enum.includes(value as string | number)
    ) {
      throw createCryptoBusinessError(
        `参数 ${parameterName(definition.name)} 必须是 ${definition.enum.join(' / ')} 之一`
      )
    }
    output[definition.name] = value
  }
  return output
}
