import { createHash } from 'node:crypto'

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))
      .map(([key, child]) => [key, canonicalize(child)])
  )
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
}
