import type { CryptoAlgorithm } from './types.js'

export function toPublicCryptoAlgorithm(algorithm: CryptoAlgorithm) {
  return {
    algorithm: algorithm.name,
    name: algorithm.title,
    description: algorithm.summary,
    keyRequired: algorithm.requiresKey ?? false,
    example: {
      algorithm: algorithm.name,
      action: 'encode' as const,
      input: 'Hello',
      ...(algorithm.requiresKey ? { key: 'your-secret' } : {})
    }
  }
}
