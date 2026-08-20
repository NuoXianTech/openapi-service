import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../src/http/types.js'
import {
  parseOutputEncoding,
  respondWithEncoded,
  respondWithInvalidEncoding
} from '../src/shared/output-encoding.js'

describe('shared output encoding', () => {
  it('normalizes supported values and rejects unknown encodings', () => {
    expect(parseOutputEncoding({})).toBe('json')
    expect(parseOutputEncoding({ encode: ' TEXT ' })).toBe('text')
    expect(parseOutputEncoding({ encoding: 'md' })).toBe('markdown')
    expect(parseOutputEncoding({ encode: 'image' }, ['image'])).toBe('image')
    expect(parseOutputEncoding({ encode: 'xml' })).toBeNull()
  })

  it('writes each representation with stable content and cache headers', async () => {
    const app = new Hono<AppEnv>()
    const data = { value: 'example' }
    app.get('/:encoding', (c) => {
      const encoding = parseOutputEncoding({ encode: c.req.param('encoding') })
      if (!encoding) return respondWithInvalidEncoding(c)
      return respondWithEncoded(c, encoding, data, {
        message: 'encoded',
        text: item => item.value,
        markdown: item => `# ${item.value}`,
        cacheControl: 'public, max-age=60'
      })
    })

    const json = await app.request('/json')
    expect(await json.json()).toMatchObject({
      code: 'OK',
      message: 'encoded',
      data
    })
    expect(json.headers.get('cache-control')).toBe('public, max-age=60')

    const text = await app.request('/text')
    expect(await text.text()).toBe('example')
    expect(text.headers.get('content-type')).toContain('text/plain')

    const markdown = await app.request('/markdown')
    expect(await markdown.text()).toBe('# example')
    expect(markdown.headers.get('content-type')).toContain('text/markdown')

    const invalid = await app.request('/xml')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_ENCODING' })
  })
})
