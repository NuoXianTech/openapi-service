import { describe, expect, it } from 'vitest'
import { createOpenAPIContract } from '../../src/contracts/openapi.js'

describe('createOpenAPIContract', () => {
  it('produces the same digest for equivalent object key orders', () => {
    const first = createOpenAPIContract({
      paths: {
        '/v1/z': { get: { tags: ['z', 'a'] } },
        '/v1/a': { get: {} }
      },
      openapi: '3.1.0',
      info: {
        version: '0.1.0',
        title: 'OpenAPI Service'
      }
    })
    const second = createOpenAPIContract({
      info: {
        title: 'OpenAPI Service',
        version: '0.1.0'
      },
      openapi: '3.1.0',
      paths: {
        '/v1/a': { get: {} },
        '/v1/z': { get: { tags: ['z', 'a'] } }
      }
    })

    expect(first.sha256).toBe(second.sha256)
    expect(Object.keys(first.document)).toEqual([
      'info',
      'openapi',
      'paths'
    ])
    expect(
      Object.keys(first.document.paths as Record<string, unknown>)
    ).toEqual(['/v1/a', '/v1/z'])
    expect(
      (
        (
          first.document.paths as Record<
            string,
            { get: { tags: string[] } }
          >
        )['/v1/z']
      )?.get.tags
    ).toEqual(['z', 'a'])
  })
})
