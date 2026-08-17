import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config/load.js'
import {
  clearBingCache,
  createBingImageUrl,
  createBingMarkdown,
  getBingImage,
  resolveBingCoverUrl
} from '../src/modules/bing/service.js'
import type { Logger } from '../src/shared/logger.js'

const serviceToken = 'bing-test-token-that-is-at-least-32-characters'
const authorization = { authorization: `Service ${serviceToken}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1',
  port: 8080,
  serviceToken,
  readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000,
  maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data',
  assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'bing-test-service',
  serviceName: 'Bing Test Service',
  version: 'test',
  commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function primaryResponse() {
  const model = {
    MediaContents: [{
      ImageContent: {
        Description: '风景描述',
        Headline: '风景标题',
        Title: '每日风景',
        Copyright: 'Bing copyright',
        Image: { Wallpaper: '/th?id=OHR.Primary_ZH-CN123.jpg' },
        QuickFact: { MainText: '风景正文' }
      }
    }]
  }
  return new Response(`<script>var _model = ${JSON.stringify(model)};</script>`)
}

function archiveResponse() {
  return new Response(JSON.stringify({
    images: [{
      url: '/th?id=OHR.Archive_ZH-CN456_1920x1080.jpg',
      title: '归档标题',
      copyright: 'Archive copyright'
    }]
  }))
}

afterEach(() => {
  clearBingCache()
  vi.unstubAllGlobals()
})

describe('bing module', () => {
  it('normalizes Bing image sizes and rejects foreign hosts', () => {
    const source = 'https://www.bing.com/th?id=OHR.Example_UHD.jpg'
    expect(createBingImageUrl(source)).toBe(
      'https://bing.com/th?id=OHR.Example_1920x1080.jpg'
    )
    expect(createBingImageUrl(source, 'UHD')).toBe(
      'https://bing.com/th?id=OHR.Example_UHD.jpg'
    )
    expect(createBingImageUrl('https://example.com/th?id=OHR.Bad')).toBe('')
  })

  it('selects mobile images from the explicit type or user agent', () => {
    const source = 'https://bing.com/th?id=OHR.Example_1920x1080.jpg'
    expect(resolveBingCoverUrl(source, 'mobile')).toContain('_768x1366.jpg')
    expect(resolveBingCoverUrl(source, 'auto', 'Mozilla/5.0 iPhone Mobile'))
      .toContain('_768x1366.jpg')
    expect(resolveBingCoverUrl(source, 'pc', 'Mozilla/5.0 iPhone Mobile'))
      .toContain('_1920x1080.jpg')
  })

  it('formats a Markdown representation', () => {
    const markdown = createBingMarkdown({
      title: '每日风景',
      headline: '风景标题',
      description: '风景描述',
      cover: 'https://bing.com/th?id=OHR.Example_1920x1080.jpg',
      cover_4k: 'https://bing.com/th?id=OHR.Example_UHD.jpg',
      main_text: '正文',
      copyright: 'Bing copyright',
      update_date: '2026-08-17 08:00:00',
      update_date_at: 1786924800000
    })
    expect(markdown).toContain('# 每日风景')
    expect(markdown).toContain('## 风景标题')
    expect(markdown).toContain('![每日风景](https://bing.com/')
  })

  it('prefers the primary page and caches the successful record', async () => {
    const request = vi.fn().mockResolvedValue(primaryResponse())
    vi.stubGlobal('fetch', request)

    const first = await getBingImage()
    const cached = await getBingImage()

    expect(first.title).toBe('每日风景')
    expect(first.cover).toContain('OHR.Primary_ZH-CN123_1920x1080.jpg')
    expect(cached).toBe(first)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('falls back to the archive API when the primary page is invalid', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('<html>no model</html>'))
      .mockResolvedValueOnce(archiveResponse())
    vi.stubGlobal('fetch', request)

    const record = await getBingImage()

    expect(record.title).toBe('归档标题')
    expect(record.cover_4k).toContain('OHR.Archive_ZH-CN456_UHD.jpg')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('serves the standard JSON envelope and raw representations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(primaryResponse()))
    const app = createApp({ config, logger })

    const jsonResponse = await app.request('/v1/bing?type=mobile', {
      headers: authorization
    })
    const body = await jsonResponse.json() as {
      code: string
      message: string
      data: { cover: string, cover_4k: string }
      timestamp: number
    }
    expect(jsonResponse.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual([
      'code', 'data', 'message', 'timestamp'
    ])
    expect(body.code).toBe('OK')
    expect(body.message).toBe('获取必应每日壁纸成功')
    expect(body.data.cover).toContain('_768x1366.jpg')
    expect(body.data.cover_4k).toContain('_UHD.jpg')
    expect(body.timestamp).toEqual(expect.any(Number))

    const textResponse = await app.request('/v1/bing?encode=text', {
      headers: authorization
    })
    expect(textResponse.headers.get('content-type')).toContain('text/plain')
    expect(await textResponse.text()).toContain('_1920x1080.jpg')

    const markdownResponse = await app.request('/v1/bing?encoding=md', {
      headers: authorization
    })
    expect(markdownResponse.headers.get('content-type'))
      .toContain('text/markdown')
    expect(await markdownResponse.text()).toContain('# 每日风景')
  })

  it('redirects image representations without following the image URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(primaryResponse()))
    const app = createApp({ config, logger })

    const image = await app.request('/v1/bing?encode=image&type=mobile', {
      headers: authorization
    })
    expect(image.status).toBe(302)
    expect(image.headers.get('location')).toContain('_768x1366.jpg')

    const image4k = await app.request('/v1/bing?encode=image-4k', {
      headers: authorization
    })
    expect(image4k.status).toBe(302)
    expect(image4k.headers.get('location')).toContain('_UHD.jpg')
  })

  it('returns a standard 502 response when both Bing sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 503 })
    ))
    const app = createApp({ config, logger })

    const response = await app.request('/v1/bing', {
      headers: authorization
    })
    const body = await response.json() as {
      code: string
      message: string
      data: null
      timestamp: number
    }
    expect(response.status).toBe(502)
    expect(body.code).toBe('UPSTREAM_ERROR')
    expect(body.data).toBeNull()
    expect(body.timestamp).toEqual(expect.any(Number))
  })
})
