import { load } from 'cheerio'
import { parseFailed, type AiMediaItem, type AiMediaResult } from './types.js'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function text(...values: unknown[]): string {
  for (const value of values) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ''
}

export function mediaUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const candidate = value.trim().replaceAll('\\/', '/').replaceAll('\\u0026', '&')
    try {
      const url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate)
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
        // Preserve the signed query exactly, including encoding and ordering.
        return candidate.startsWith('//') ? `https:${candidate}` : candidate
      }
    } catch { /* Try the next candidate. */ }
  }
  return ''
}

export function mediaItem(
  type: AiMediaItem['type'],
  value: unknown,
  source: AiMediaItem['source'],
  watermark: AiMediaItem['watermark'] = 'unknown'
): AiMediaItem | undefined {
  const url = mediaUrl(value)
  if (!url) return undefined
  const marked = /video_gen_watermark|watermark_dyn|[/?&=._-]watermark(?:[/?&=._-]|$)/i.test(url)
  return { type, url, source, watermark: marked ? 'present' : watermark }
}

export function result(value: Partial<AiMediaResult>): AiMediaResult {
  const media = [...new Map((value.media ?? []).map(item => [`${item.type}:${item.url}`, item])).values()]
  if (!media.length) throw parseFailed()
  return {
    title: value.title ?? '',
    author: value.author ?? { name: '', id: '', avatar: '' },
    cover: mediaUrl(value.cover) || media.find(item => item.type === 'image')?.url || '',
    media,
    warnings: [...new Set(value.warnings ?? [])]
  }
}

export function decodeHtml(value: string): string {
  return load(`<textarea>${value.replaceAll('<', '&lt;')}</textarea>`, null, false)('textarea').text()
}

export function decodeJson(value: unknown): unknown {
  for (let depth = 0; depth < 8 && typeof value === 'string'; depth += 1) {
    const encoded = value.trim()
    let candidate = encoded
    // Parse valid JSON before decoding HTML entities inside its string values.
    // Flight data can contain literal &quot; in unrelated component props.
    try {
      value = JSON.parse(candidate) as unknown
      continue
    } catch { /* Try a transport encoding. */ }
    if (/^%(?:7b|5b|22|25)/i.test(candidate)) {
      try { candidate = decodeURIComponent(candidate) } catch { return undefined }
    }
    if (candidate.includes('&quot;') || candidate.includes('&#')) candidate = decodeHtml(candidate)
    if (candidate === encoded) return undefined
    value = candidate
  }
  return typeof value === 'string' ? undefined : value
}

/** Bounded traversal also expands JSON embedded inside conversation messages. */
export function* records(root: unknown): Generator<Record<string, unknown>> {
  const pending = [{ value: root, depth: 0 }]
  let visited = 0
  while (pending.length && visited++ < 50_000) {
    const entry = pending.pop()!
    if (entry.depth > 32) continue
    const value = typeof entry.value === 'string' ? decodeJson(entry.value) : entry.value
    if (isRecord(value)) yield value
    const children = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ value: children[index], depth: entry.depth + 1 })
    }
  }
}

/** Read a JSON object/array without evaluating any JavaScript from the page. */
export function jsonAt(input: string, start = 0): unknown {
  while (/\s/.test(input[start] ?? '') && start < input.length) start += 1
  if (input[start] !== '{' && input[start] !== '[') return undefined
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) return decodeJson(input.slice(start, index + 1))
    }
  }
  return undefined
}

export function assignedJson(html: string, marker: string): unknown {
  const $ = load(html)
  for (const script of $('script').toArray()) {
    const content = $(script).text()
    const index = content.indexOf(marker)
    if (index < 0) continue
    const suffix = content.slice(index + marker.length)
    const assignment = suffix.match(/^\s*=\s*/)
    if (assignment) {
      const value = jsonAt(suffix, assignment[0].length)
      if (value !== undefined) return value
    }
  }
  return undefined
}
