import { readFileSync } from 'node:fs'

export interface BuildInfo {
  version?: string
  commit?: string
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function readBuildInfo(
  url: URL = new URL('./build-info.json', import.meta.url)
): BuildInfo {
  try {
    const value: unknown = JSON.parse(readFileSync(url, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

    const record = value as Record<string, unknown>
    const version = nonEmptyString(record.version)
    const commit = nonEmptyString(record.commit)
    return {
      ...(version ? { version } : {}),
      ...(commit ? { commit } : {})
    }
  } catch {
    return {}
  }
}

export const buildInfo = readBuildInfo()
