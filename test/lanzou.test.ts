import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import {
  classifyLanzouError,
  createAcwScV2Cookie,
  parseLanzouFile,
  parseLanzouShareUrl
} from '../src/modules/lanzou/service.js'
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

const token = 'lanzou-test-token-that-is-at-least-32-characters'
const headers = { authorization: `Service ${token}` }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: token,
  readHeaderTimeoutMs: 5_000, requestTimeoutMs: 20_000,
  shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets',
  configurationFile: 'data/runtime/test.enc', serviceId: 'lanzou-test',
  serviceName: 'Lanzou Test', version: 'test', commit: 'test'
}
const logger: Logger = { info() {}, error() {} }
const PUBLIC_SHARE = `
  <div style="font-size: 30px">头像.txt</div>
  <span class="p7">文件大小：</span>30.2 K<br>
  <iframe src="/fn?token=public"></iframe>`
const PUBLIC_DOWNLOAD = `<script>
  var wp_sign = 'public-sign'; var ajaxdata = 'web-sign';
  $.ajax({ url: '/ajaxfile.php?file=13180693' });
</script>`
const PASSWORD_SHARE = `<div class="n_filesize">大小：10.3 M</div><script>
  var isngis = 'current-sign';
  function down_p() { $.ajax({ url: '/ajaxm.php?file=25792756',
    data: { 'action':'downprocess', 'sign':isngis, 'kd':kdns, 'p':pwd } }); }
</script>`

afterEach(() => vi.unstubAllGlobals())

function responseAt(body: BodyInit | null, url: string): Response {
  const response = new Response(body)
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function capture(action: () => unknown): unknown {
  try { action() } catch (error) { return error }
  throw new Error('expected action to throw')
}
async function captureAsync(action: () => Promise<unknown>): Promise<unknown> {
  try { await action() } catch (error) { return error }
  throw new Error('expected action to reject')
}

describe('lanzou module', () => {
  it('preserves supported share domains and rejects unsafe inputs', () => {
    expect(parseLanzouShareUrl(
      'https://www.lanzouq.com/iGNHA6th9cd?pwd=secret'
    ).toString()).toBe('https://www.lanzouq.com/iGNHA6th9cd?pwd=secret')
    for (const input of [
      'http://www.lanzouq.com/iGNHA6th9cd',
      'https://user:pass@www.lanzouq.com/iGNHA6th9cd',
      'https://www.lanzouq.com.evil.test/iGNHA6th9cd',
      'https://example.com/iGNHA6th9cd'
    ]) {
      expect(classifyLanzouError(capture(() => parseLanzouShareUrl(input))).code)
        .toBe('INVALID_URL')
    }
    expect(classifyLanzouError(capture(() => (
      parseLanzouShareUrl('https://www.lanzouq.com/b012345')
    ))).code).toBe('UNSUPPORTED_RESOURCE')
  })

  it('computes the Alibaba Cloud challenge cookie', () => {
    expect(createAcwScV2Cookie('0123456789abcdef0123456789abcdef01234567'))
      .toBe('d2c7186598ab1a508a4f6064e4fa746323ab17c6')
    expect(createAcwScV2Cookie('invalid')).toBeNull()
  })

  it('parses a public file and removes only the internal pid', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(PUBLIC_SHARE))
      .mockResolvedValueOnce(new Response(PUBLIC_DOWNLOAD))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        zt: 1, inf: 0, dom: 'https://developer2.lanrar.com',
        url: 'signed/file-token?pid=internal&fn=avatar.txt'
      })))
      .mockResolvedValueOnce(new Response('warmup'))
      .mockResolvedValueOnce(new Response('download'))
    vi.stubGlobal('fetch', request)
    const data = await parseLanzouFile(
      parseLanzouShareUrl('https://www.lanzouq.com/iGNHA6th9cd')
    )
    expect(data).toEqual({
      name: '头像.txt', size: '30.2 K',
      url: 'https://developer2.lanrar.com/file/signed/file-token?fn=avatar.txt'
    })
    expect(request).toHaveBeenCalledTimes(5)
    expect(String(request.mock.calls[0]?.[0]))
      .toBe('https://www.lanzouq.com/iGNHA6th9cd')
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST'
    })
    expect(String(request.mock.calls[2]?.[0])).toContain(
      '/ajaxfile.php?file=13180693'
    )
    const temporaryUrl = 'https://developer2.lanrar.com/file/signed/file-token?pid=internal&fn=avatar.txt'
    expect(String(request.mock.calls[3]?.[0])).toBe(temporaryUrl)
    expect(String(request.mock.calls[4]?.[0])).toBe(temporaryUrl)
    expect(request.mock.calls[4]?.[1]?.headers).toMatchObject({
      cookie: 'down_ip=1'
    })
    expect(request.mock.calls[4]?.[1]).toMatchObject({
      allowedHosts: expect.arrayContaining(['webgetstore.com'])
    })
  })

  it('retries an arg1 challenge with the generated Cookie', async () => {
    const argument = '0123456789abcdef0123456789abcdef01234567'
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(`<script>var arg1='${argument}'</script>`))
      .mockResolvedValueOnce(new Response(PUBLIC_SHARE))
      .mockResolvedValueOnce(new Response(PUBLIC_DOWNLOAD))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        zt: 1,
        dom: 'https://developer2.lanrar.com',
        url: 'signed/file-token'
      })))
      .mockResolvedValueOnce(new Response('warmup'))
      .mockResolvedValueOnce(new Response('download'))
    vi.stubGlobal('fetch', request)

    await parseLanzouFile(
      parseLanzouShareUrl('https://abc.lanzouq.com/iGNHA6th9cd')
    )

    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      cookie: 'acw_sc__v2=d2c7186598ab1a508a4f6064e4fa746323ab17c6'
    })
    expect(request.mock.calls[2]?.[1]?.headers).toMatchObject({
      cookie: 'acw_sc__v2=d2c7186598ab1a508a4f6064e4fa746323ab17c6'
    })
  })

  it('falls back to lanzouf when an old share domain cannot connect', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('certificate failure'))
      .mockResolvedValueOnce(new Response(PUBLIC_SHARE))
      .mockResolvedValueOnce(new Response(PUBLIC_DOWNLOAD))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        zt: 1,
        dom: 'https://developer2.lanrar.com',
        url: 'fallback-token'
      })))
      .mockResolvedValueOnce(new Response('warmup'))
      .mockResolvedValueOnce(new Response('download'))
    vi.stubGlobal('fetch', request)

    await expect(parseLanzouFile(parseLanzouShareUrl(
      'https://www.lanzous.com/iGNHA6th9cd'
    ))).resolves.toMatchObject({ name: '头像.txt' })
    expect(String(request.mock.calls[0]?.[0]))
      .toBe('https://www.lanzous.com/iGNHA6th9cd')
    expect(String(request.mock.calls[1]?.[0]))
      .toBe('https://www.lanzouf.com/iGNHA6th9cd')
  })

  it('supports query-style pages without an iframe', async () => {
    const queryPage = `<div class="n_box_3fn">query.txt</div><script>
      var ajaxdata = 'ignored';
      const first = { 'sign':'first-sign' };
      const second = { 'sign':'query-sign' };
      $.ajax({ url: '/ajaxm.php?file=99' });
    </script>`
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(queryPage))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        zt: 1,
        dom: 'https://developer2.lanrar.com',
        url: 'query-token'
      })))
      .mockResolvedValueOnce(new Response('warmup'))
      .mockResolvedValueOnce(new Response('download'))
    vi.stubGlobal('fetch', request)

    await expect(parseLanzouFile(parseLanzouShareUrl(
      'https://www.lanzouq.com/iGNHA6th9cd?from=legacy'
    ))).resolves.toMatchObject({ name: 'query.txt' })
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('websignkey=Em2R')
    expect(String(request.mock.calls[1]?.[1]?.body)).toContain('sign=query-sign')
  })

  it('handles password-required and invalid-password responses safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(PASSWORD_SHARE)))
    const missing = await captureAsync(() => parseLanzouFile(
      parseLanzouShareUrl('https://www.lanzous.com/i42Xxebssfg')
    ))
    expect(classifyLanzouError(missing).code).toBe('PASSWORD_REQUIRED')

    const password = 'do-not-expose'
    const invalidRequest = vi.fn()
      .mockResolvedValueOnce(new Response(PASSWORD_SHARE))
      .mockResolvedValueOnce(new Response(JSON.stringify({ zt: 0, inf: '密码不正确' })))
    vi.stubGlobal('fetch', invalidRequest)
    const invalid = await captureAsync(() => parseLanzouFile(
      parseLanzouShareUrl('https://www.lanzous.com/i42Xxebssfg'), password
    ))
    const result = classifyLanzouError(invalid)
    expect(result.code).toBe('INVALID_PASSWORD')
    expect(JSON.stringify(result)).not.toContain(password)
    expect(String(invalidRequest.mock.calls[1]?.[1]?.body))
      .toContain('sign=current-sign')
  })

  it('rejects untrusted download domains', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(PUBLIC_SHARE))
      .mockResolvedValueOnce(new Response(PUBLIC_DOWNLOAD))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        zt: 1, dom: 'https://internal.example.com', url: 'file-token'
      }))))
    const error = await captureAsync(() => parseLanzouFile(
      parseLanzouShareUrl('https://www.lanzouq.com/iGNHA6th9cd')
    ))
    expect(classifyLanzouError(error).code).toBe('UPSTREAM_INVALID_RESPONSE')
  })

  it('serves the standard response and a validated final redirect', async () => {
    const responses = () => [
      new Response(PUBLIC_SHARE), new Response(PUBLIC_DOWNLOAD),
      new Response(JSON.stringify({
        zt: 1, inf: '头像.txt', dom: 'https://developer2.lanrar.com',
        url: 'signed/file-token?pid=temporary&fn=avatar.txt'
      })),
      new Response('warmup'),
      responseAt(
        'download',
        'https://pdf2.webgetstore.com/file/final-token?pid=private&fn=avatar.txt'
      )
    ]
    const queue = responses()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => queue.shift()))
    const app = createApp({ config, logger })
    const encoded = encodeURIComponent('https://www.lanzouq.com/iGNHA6th9cd')
    const response = await app.request(`/v1/lanzou?url=${encoded}`, { headers })
    const body = await response.json() as {
      code: string
      data: { name: string, url: string }
    }
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ code: 'OK', data: { name: '头像.txt' } })
    expect(body.data.url).toBe(
      'https://pdf2.webgetstore.com/file/final-token?fn=avatar.txt'
    )
    expect(response.headers.get('cache-control')).toBe('no-store')

    const redirectQueue = responses()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => redirectQueue.shift()))
    const redirect = await app.request(`/v1/lanzou?url=${encoded}&type=down`, { headers })
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe(
      'https://pdf2.webgetstore.com/file/final-token?fn=avatar.txt'
    )
  })
})
