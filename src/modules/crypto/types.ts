export interface CryptoOptionDefinition {
  name: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: string | number | boolean
  min?: number
  max?: number
  enum?: Array<string | number>
  modes?: CryptoMode[]
  description: string
}

export type CryptoMode = 'encrypt' | 'decrypt'
export type CryptoAction = 'encode' | 'decode'

export interface CryptoAlgorithm {
  name: string
  title: string
  description: string
  summary: string
  requiresKey?: boolean
  modes: CryptoMode[]
  options?: CryptoOptionDefinition[]
  exec(input: {
    mode: CryptoMode
    text: string
    options: Record<string, unknown>
  }): Promise<{ text: string }> | { text: string }
}

export interface CryptoBusinessError extends Error {
  readonly name: 'CryptoBusinessError'
  readonly bizCode: string
}

export function createCryptoBusinessError(
  message: string,
  bizCode = 'CRYPTO_FAILED'
): CryptoBusinessError {
  return Object.assign(new Error(message), {
    name: 'CryptoBusinessError' as const,
    bizCode
  })
}

export function isCryptoBusinessError(
  error: unknown
): error is CryptoBusinessError {
  return error instanceof Error
    && error.name === 'CryptoBusinessError'
    && typeof (error as { bizCode?: unknown }).bizCode === 'string'
}
