/** Keep large JSON integer literals intact before identifiers are normalized. */
export function parseJsonPreservingIntegers(input: string): unknown {
  return JSON.parse(input, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)
      && context?.source && /^-?\d+$/.test(context.source)) {
      return context.source
    }
    return value
  }) as unknown
}
