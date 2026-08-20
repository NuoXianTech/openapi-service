import { z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { AppEnv } from '../http/types.js'
import { respondWithFailure, respondWithSuccess } from './response.js'

export const OutputEncodingQuerySchema = z.object({
  encode: z.string().optional(),
  encoding: z.string().optional()
})

export type OutputEncoding = 'json' | 'text' | 'markdown'
export type OutputEncodingQuery = {
  encode?: string | undefined
  encoding?: string | undefined
}

export function parseOutputEncoding<TExtra extends string = never>(
  query: OutputEncodingQuery,
  extra: readonly TExtra[] = []
): OutputEncoding | TExtra | null {
  const value = (query.encode ?? query.encoding ?? '').trim().toLowerCase()
  if (!value || value === 'json') return 'json'
  if (value === 'text') return 'text'
  if (value === 'markdown' || value === 'md') return 'markdown'
  return extra.includes(value as TExtra) ? value as TExtra : null
}

export function respondWithInvalidEncoding(c: Context<AppEnv>) {
  return respondWithFailure(
    c,
    400,
    'INVALID_ENCODING',
    'encode 必须是 json、text、markdown 或 md'
  )
}

export function respondWithEncoded<T>(
  c: Context<AppEnv>,
  encoding: OutputEncoding,
  data: T,
  options: {
    message: string
    text: (data: T) => string
    markdown: (data: T) => string
    cacheControl?: string
  }
) {
  const cacheControl = options.cacheControl ?? 'no-store'
  c.header('cache-control', cacheControl)
  if (encoding === 'text') return c.text(options.text(data))
  if (encoding === 'markdown') {
    return c.text(options.markdown(data), 200, {
      'content-type': 'text/markdown; charset=UTF-8'
    })
  }
  return respondWithSuccess(c, data, options.message, cacheControl)
}
