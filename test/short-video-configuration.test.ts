import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { ServiceConfigurationManager } from '../src/configuration/manager.js'
import { serviceConfigurationDefinition } from '../src/modules/index.js'
import { SHORT_VIDEO_PLATFORMS } from '../src/modules/short-video/types.js'
import type { Logger } from '../src/shared/logger.js'

vi.mock('../src/shared/safe-fetch.js', () => ({
  safeFetch: (input: string | URL, options: RequestInit) => (
    globalThis.fetch(input, options)
  ),
  isHostnameWithin: (hostname: string, allowed: string) => (
    hostname === allowed || hostname.endsWith(`.${allowed}`)
  )
}))
vi.mock('../src/shared/limited-response.js', () => ({
  readLimitedText: (response: Response) => response.text()
}))

const token = 'short-video-config-token-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  configurationKey: Buffer.alloc(32, 1),
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc',
  serviceId: 'short-video-config-test',
  serviceName: 'Short Video Config Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }

function configuration(initialValues: Record<string, unknown> = {}) {
  return new ServiceConfigurationManager({
    serviceId: config.serviceId,
    definition: serviceConfigurationDefinition,
    initialValues
  })
}

const BILIBILI_SHARE = 'https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('short-video configuration definition', () => {
  it('publishes an enable switch and a cookie field per platform', () => {
    const fields = configuration().getDefinition().groups
      .flatMap(group => group.fields)

    expect(fields).toContainEqual(
      expect.objectContaining({
        key: 'shortVideo.enabledPlatforms',
        type: 'multi-select'
      })
    )
    for (const platform of SHORT_VIDEO_PLATFORMS) {
      expect(fields).toContainEqual(
        expect.objectContaining({
          key: `shortVideo.${platform}Cookie`,
          type: 'secret'
        })
      )
    }
  })

  it('enables every platform by default', () => {
    expect(configuration().getValue<string[]>('shortVideo.enabledPlatforms'))
      .toEqual([...SHORT_VIDEO_PLATFORMS])
  })

  it('redacts configured short-video cookies', () => {
    const manager = configuration({
      'shortVideo.douyinCookie': 'sessionid=secret'
    })
    expect(manager.getRedactedState().values['shortVideo.douyinCookie'])
      .toEqual({ configured: true })
    expect(JSON.stringify(manager.getRedactedState())).not.toContain('secret')
  })
})

describe('short-video configuration behaviour', () => {
  it('rejects platforms disabled by Service configuration', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const app = createApp({
      config,
      logger,
      configuration: configuration({
        'shortVideo.enabledPlatforms': ['douyin']
      })
    })

    const response = await app.request(
      `/v1/short-video?url=${BILIBILI_SHARE}`,
      { headers }
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'SHORT_VIDEO_PLATFORM_DISABLED',
      data: null
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the configured cookie to the matching platform only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"code":-404}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    const app = createApp({
      config,
      logger,
      configuration: configuration({
        'shortVideo.bilibiliCookie': 'SESSDATA=configured-value',
        'shortVideo.douyinCookie': 'sessionid=other-platform'
      })
    })

    await app.request(`/v1/short-video?url=${BILIBILI_SHARE}`, { headers })

    expect(fetchMock).toHaveBeenCalled()
    for (const [, options] of fetchMock.mock.calls) {
      const sent = new Headers(options?.headers)
      expect(sent.get('cookie')).toBe('SESSDATA=configured-value')
    }
  })

  it('omits the cookie header when no cookie is configured', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"code":-404}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    const app = createApp({ config, logger })

    await app.request(`/v1/short-video?url=${BILIBILI_SHARE}`, { headers })

    expect(fetchMock).toHaveBeenCalled()
    for (const [, options] of fetchMock.mock.calls) {
      expect(new Headers(options?.headers).has('cookie')).toBe(false)
    }
  })
})
