import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { ServiceConfig } from '../src/config.js'
import { ServiceConfigurationManager } from '../src/configuration/manager.js'
import { serviceConfigurationDefinition } from '../src/modules/index.js'
import { parseAiMedia } from '../src/modules/ai-media/index.js'
import { detectAiMediaPlatform, parseAiMediaUrl } from '../src/modules/ai-media/input.js'
import { decipherFplayUrl } from '../src/modules/ai-media/platforms/doubao.js'
import { AiMediaDataSchema, AiMediaResponseSchema } from '../src/modules/ai-media/schema.js'
import { AI_MEDIA_LABELS, AI_MEDIA_PLATFORMS, type AiMediaData, type AiMediaPlatform } from '../src/modules/ai-media/types.js'
import { safeFetch } from '../src/shared/safe-fetch.js'

vi.mock('../src/shared/safe-fetch.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/shared/safe-fetch.js')>(),
  safeFetch: vi.fn()
}))

const fetchMock = vi.mocked(safeFetch)
const JIMENG = 'https://jimeng.jianying.com/ai-tool/share/item/123'
const DOUBAO = 'https://www.doubao.com/video-sharing?share_id=456&video_id=video123'
const THREAD = 'https://www.doubao.com/thread/example'
const HAILUO = 'https://hailuoai.com/share/ai-video/example'
const QIANWEN = 'https://activity.qianwen.com/r/ai-studio-mobile/qwen-external-share?shareId=example'
const TOKEN = 'ai-media-test-token-at-least-32-characters'
const headers = { authorization: 'Service ' + TOKEN }
const config: ServiceConfig = {
  hostname: '127.0.0.1', port: 8080, serviceToken: TOKEN,
  configurationKey: Buffer.alloc(32, 1), readHeaderTimeoutMs: 5_000,
  requestTimeoutMs: 20_000, shutdownTimeoutMs: 10_000, maxRequestBodyBytes: 1024 * 1024,
  dataDirectory: 'data', assetsDirectory: 'data/assets', configurationFile: 'data/runtime/test.enc',
  serviceId: 'ai-media-test', serviceName: 'AI Media Test', version: 'test', commit: 'test'
}
const logger = { info() {}, error() {} }
const GOLDEN = {
  seed: 'YWktbWVkaWEtZml4dHVyZS1zZWVk',
  encrypted: 'AAAAAWI7vXhrLq5tQ1LBUa_KZgqSZMlihd06s6wxxItxry0cCpae0a2aoPqTsWGtA1KroTCDH_qjZJcD1PYQl_PQHGg',
  url: 'https://video.example.com/original.mp4?token=a%2Fb&expires=123'
}

function json(value: unknown): Response {
  return Response.json(value)
}

function redirected(url: string): Response {
  return Object.defineProperty(new Response(''), 'url', { value: url })
}

function configuration(values: Record<string, unknown> = {}) {
  return new ServiceConfigurationManager({
    serviceId: config.serviceId, definition: serviceConfigurationDefinition, initialValues: values
  })
}

function app(manager = configuration(), timeout = config.requestTimeoutMs) {
  return createApp({ config: { ...config, requestTimeoutMs: timeout }, logger, configuration: manager })
}

function route(platform: AiMediaPlatform, url: string): string {
  return '/v1/ai-media/' + platform + '?url=' + encodeURIComponent(url)
}

function threadPage(payload: unknown): Response {
  const encoded = JSON.stringify(payload).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  return new Response('<script data-fn-name="r" data-fn-args="' + encoded + '" nonce="test"></script>')
}

function qianwenPage(initialData: unknown): Response {
  return new Response('<script>window.__INITIAL_PROPS__ = ' + JSON.stringify({ initialData })
    + '; window.unrelated = true;</script>')
}

function publicDoubao(): Response {
  return json({ code: 0, data: {
    prompt: '测试视频',
    play_info: { main: 'https://video.example.com/preview.mp4?lr=video_gen_watermark_dyn&token=a%2Fb', poster_url: 'https://image.example.com/cover.jpg' },
    user_info: { nickname: '作者', user_id: '123' }
  } })
}

async function readMediaData(response: Response): Promise<AiMediaData> {
  const body = await response.json()
  expect(Object.keys(body).sort()).toEqual(['code', 'data', 'message', 'timestamp'])
  expect(body.message).toBe('解析成功')
  expect(Object.keys(body.data).sort()).toEqual(['author', 'avatar', 'cover', 'media', 'title', 'uid'])
  return AiMediaResponseSchema.parse(body).data
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new Error('unexpected upstream request'))
})

describe('AI media input and contract', () => {
  it.each([
    ['doubao', THREAD],
    ['jimeng', 'https://v.jimeng.aiseet.atry.com/s/test/'],
    ['xiaoyunque', 'https://xyq.jianying.com/s/test/'],
    ['kling', 'https://klingai-share.kuaishou.com/h5-app/share?work_id=123'],
    ['hailuo', 'https://www.hailuoai.video/share/ai-video/test'],
    ['qianwen', 'https://pages.tongyi.com/share/test']
  ])('detects %s', (platform, url) => {
    expect(detectAiMediaPlatform(parseAiMediaUrl('复制链接：' + url + '。'))).toBe(platform)
  })

  it.each([
    ['doubao', '', 'MISSING_PARAMETER', 400],
    ['doubao', 'https://user:secret@www.doubao.com/thread/test', 'INVALID_PARAMETER', 400],
    ['doubao', 'https://www.doubao.com:8443/thread/test', 'INVALID_PARAMETER', 400],
    ['doubao', 'https://doubao.com.evil.test/thread/test', 'UNSUPPORTED_PLATFORM', 422],
    ['doubao', 'https://127.0.0.1/private', 'UNSUPPORTED_PLATFORM', 422],
    ['doubao', 'x'.repeat(4097), 'INVALID_PARAMETER', 400],
    ['doubao', 'https://www.doubao.com/video-sharing?share_id=123', 'INVALID_PARAMETER', 400],
    ['kling', 'https://klingai-share.kuaishou.com/h5-app/share?creative_id=nope', 'INVALID_PARAMETER', 400]
  ] as const)('rejects invalid %s input %s without a request', async (platform, url, code, status) => {
    const response = await app().request(route(platform, url), { headers })
    expect(response.status).toBe(status)
    expect(response.headers.get('x-openapi-error-code')).toBe(code)
    expect(await response.json()).toMatchObject({ code, data: null, message: expect.any(String), timestamp: expect.any(Number) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes six fixed routes with distinct products and one shared response contract', async () => {
    const response = await app().request('/openapi.json', { headers })
    const document = await response.json()
    const paths = Object.keys(document.paths).filter(path => path.startsWith('/v1/ai-media/'))
    expect(paths.sort()).toEqual(AI_MEDIA_PLATFORMS.map(platform => '/v1/ai-media/' + platform).sort())
    const tags = new Set<string>()
    const operationIds = new Set<string>()
    for (const platform of AI_MEDIA_PLATFORMS) {
      const operation = document.paths['/v1/ai-media/' + platform].get
      const name = platform[0]!.toUpperCase() + platform.slice(1)
      expect(operation.operationId).toBe('parse' + name + 'Media')
      expect(operation.tags).toEqual([name + ' Media'])
      expect(operation).not.toHaveProperty('summary')
      expect(operation.security).toEqual([{ serviceToken: [] }])
      expect(operation.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/AiMediaResponse'
      })
      tags.add(operation.tags[0])
      operationIds.add(operation.operationId)
    }
    expect(tags.size).toBe(6)
    expect(operationIds.size).toBe(6)
    expect(document.paths['/v1/ai-media']).toBeUndefined()
    expect(document.paths['/v1/ai-media/{platform}']).toBeUndefined()
    const schemas = document.components.schemas
    expect(schemas.AiMediaResponse.properties.data).toEqual({ $ref: '#/components/schemas/AiMediaData' })
    expect(Object.keys(schemas.AiMediaData.properties).sort()).toEqual(['author', 'avatar', 'cover', 'media', 'title', 'uid'])
    expect(schemas.AiMediaData.required.sort()).toEqual(['author', 'avatar', 'cover', 'media', 'title', 'uid'])
    expect(schemas.AiMediaData.additionalProperties).toBe(false)
    expect(schemas.AiMediaData.properties.media.minItems).toBe(1)
    expect(Object.keys(schemas.AiMediaItem.properties).sort()).toEqual(['type', 'url', 'variant', 'watermark'])
    expect(schemas.AiMediaItem.properties.variant.enum).toEqual(['original', 'download', 'preview'])
    expect(schemas.AiMediaItem.properties.watermark.enum).toEqual(['none', 'ai-generated', 'present', 'unknown'])
    expect(schemas.AiMediaAuthor).toBeUndefined()
  })

  it.each(AI_MEDIA_PLATFORMS)('requires the Service Token for %s', async platform => {
    const response = await app().request(route(platform, ''))
    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(AI_MEDIA_PLATFORMS)('rejects a mismatched share URL at the %s endpoint before calling upstream', async platform => {
    const url = platform === 'doubao' ? JIMENG : DOUBAO
    const response = await app().request(route(platform, url), { headers })
    expect(response.status).toBe(400)
    expect(response.headers.get('x-openapi-error-code')).toBe('AI_MEDIA_PLATFORM_MISMATCH')
    expect(await response.json()).toMatchObject({
      code: 'AI_MEDIA_PLATFORM_MISMATCH',
      message: '请提供' + AI_MEDIA_LABELS[platform] + '分享链接',
      data: null
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['/v1/ai-media', '/v1/ai-media/unknown', '/v1/media/doubao'])('does not expose the removed or unknown route %s', async path => {
    const response = await app().request(path, { headers })
    expect(response.status).toBe(404)
    expect(response.headers.get('x-openapi-error-code')).toBe('NOT_FOUND')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('AI media platform parsing', () => {
  it.each([
    ['42', '42'],
    ['0', '0'],
    ['9007199254740993', '9007199254740993'],
    ['9223372036854775807', '9223372036854775807'],
    ['"000123"', '000123'],
    ['"user_a1"', 'user_a1'],
    ['null', null],
    ['42.5', null]
  ] as const)('normalizes upstream UID %s without losing precision or changing its meaning', async (uid, expected) => {
    fetchMock.mockResolvedValueOnce(new Response(
      '{"status":200,"result":1,"data":{"userProfile":{"userId":' + uid + '},'
      + '"resource":{"resource":"https://video.example.com/work.mp4"}}}'
    ))
    const response = await app().request(route('kling', 'https://klingai-share.kuaishou.com/h5-app/share?work_id=123'), { headers })
    expect(response.status).toBe(200)
    expect((await readMediaData(response)).uid).toBe(expected)
  })

  it('preserves integer UIDs inside nested encoded page data', async () => {
    const payload = '{"data":{"creator":{"authorId":9223372036854775807},'
      + '"images":[{"downloadUrl":"https://image.example.com/result.png"}]}}'
    fetchMock.mockResolvedValueOnce(qianwenPage(encodeURIComponent(encodeURIComponent(payload))))
    const response = await app().request(route('qianwen', QIANWEN), { headers })
    expect(response.status).toBe(200)
    expect((await readMediaData(response)).uid).toBe('9223372036854775807')
  })

  it('uses null for unavailable metadata and discards invalid optional URLs', async () => {
    fetchMock.mockResolvedValueOnce(json({ ret: 0, data: {
      common_attr: { description: '  ', cover_url: 'javascript:alert(1)' },
      author: { name: ' ', avatar_url: 'ftp://image.example.com/avatar.png' },
      video: { origin_video: { video_url: GOLDEN.url } }
    } }))
    const response = await app().request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(200)
    expect(await readMediaData(response)).toEqual({
      author: null,
      uid: null,
      avatar: null,
      title: null,
      cover: null,
      media: [{ type: 'video', url: GOLDEN.url, variant: 'original', watermark: 'none' }]
    })
  })

  it('uses the first result image as the cover when upstream has no cover', async () => {
    fetchMock.mockResolvedValueOnce(qianwenPage({ images: [
      { downloadUrl: 'https://image.example.com/first.png?signature=a%2Fb' },
      { downloadUrl: 'https://image.example.com/second.png' }
    ] }))
    const response = await app().request(route('qianwen', QIANWEN), { headers })
    const data = await readMediaData(response)
    expect(data.title).toBeNull()
    expect(data.author).toBeNull()
    expect(data.cover).toBe('https://image.example.com/first.png?signature=a%2Fb')
    expect(data.media).toHaveLength(2)
  })

  it('accepts case-insensitive HTTP schemes without rewriting signed URLs', async () => {
    const url = 'HTTPS://video.example.com/original.mp4?signature=a%2Fb&part=1'
    fetchMock.mockResolvedValueOnce(json({ ret: 0, data: {
      video: { origin_video: { video_url: url } }
    } }))
    const response = await app().request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(200)
    expect((await readMediaData(response)).media[0]?.url).toBe(url)
  })

  it('rejects redundant fields, empty media lists and null successful data in the contract', () => {
    const data = {
      author: null, uid: null, avatar: null, title: null, cover: null,
      media: [{ type: 'video', url: GOLDEN.url, variant: 'original', watermark: 'none' }]
    }
    expect(AiMediaDataSchema.safeParse(data).success).toBe(true)
    for (const invalid of [
      { ...data, platform: 'doubao' },
      { ...data, warnings: [] },
      { ...data, cover: '' },
      { ...data, coverUrl: null },
      { ...data, author: { id: '123', name: '作者', avatarUrl: null } },
      { ...data, uid: 123 },
      { ...data, title: '' },
      { ...data, media: [] },
      { ...data, media: [{ ...data.media[0], source: 'original' }] },
      { ...data, media: [{ ...data.media[0], url: 'ftp://video.example.com/media.mp4' }] }
    ]) {
      expect(AiMediaDataSchema.safeParse(invalid).success).toBe(false)
    }
    expect(AiMediaResponseSchema.safeParse({
      code: 'OK', message: '解析成功', data: null, timestamp: 0
    }).success).toBe(false)
  })

  it('selects the original Jimeng rendition and highest quality cover', async () => {
    fetchMock.mockResolvedValueOnce(json({ ret: '0', data: {
      common_attr: { description: '作品', cover_url_map: { '720': 'https://image.example.com/720.jpg', '4096': 'https://image.example.com/4096.jpg' } },
      author: { name: '作者', uid: '123' },
      video: {
        origin_video: { video_url: 'https://video.example.com/raw.mp4?signature=a%2Fb' },
        transcoded_video: { small: { video_url: 'https://video.example.com/preview.mp4', width: 640, height: 360 } }
      }
    } }))
    const response = await app().request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await readMediaData(response)).toEqual({
      author: '作者', uid: '123', avatar: null, title: '作品',
      cover: 'https://image.example.com/4096.jpg', media: [{
        url: 'https://video.example.com/raw.mp4?signature=a%2Fb', type: 'video', variant: 'original', watermark: 'none'
      }]
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({ published_item_id: '123' })
  })

  it('does not mistake a marked original rendition for clean media', async () => {
    fetchMock.mockResolvedValueOnce(json({ ret: 0, data: { video: {
      origin_video: { video_url: 'https://video.example.com/origin.mp4?lr=display_watermark_ending&signature=keep' }
    } } }))
    const data = await parseAiMedia(JIMENG)
    expect(data.media[0]?.watermark).toBe('present')
    expect(data.media[0]?.url).toContain('signature=keep')
  })

  it('resolves Jimeng short links and ranks fallback renditions by resolution', async () => {
    fetchMock.mockResolvedValueOnce(redirected(JIMENG))
      .mockResolvedValueOnce(json({ ret: '0', data: { video: { transcoded_video: {
        bad: { width: 'invalid', height: 'NaN', video_url: 'javascript:alert(1)' },
        small: { width: 640, height: 360, bitrate: 999999, video_url: 'https://video.example.com/small.mp4' },
        large: { width: 1920, height: 1080, video_url: 'https://video.example.com/large.mp4' }
      } } } }))
    const data = await parseAiMedia('https://jimeng.jianying.com/s/test/?t=210')
    expect(data.media[0]).toMatchObject({ url: 'https://video.example.com/large.mp4', watermark: 'unknown' })
  })

  it('resolves Xiaoyunque short links even when they contain tracking parameters', async () => {
    fetchMock.mockResolvedValueOnce(redirected('https://xiaoyunque.jianying.com/activities/pippit_share?artifact_id=123&generate_id=abc'))
      .mockResolvedValueOnce(json({ err_no: 0, data: { page_info: { generate_page: {
        user_info: { nick_name: '作者', user_id: 42 },
        item_info: { desc: '作品', image_info: [{ image_url: 'https://image.example.com/original.png' }],
          video_info: { main_url: 'https://video.example.com/video.mp4' } }
      } } } }))
    const response = await app().request(route('xiaoyunque', 'https://xiaoyunque.jianying.com/s/test/?t=123'), { headers })
    expect(response.status).toBe(200)
    const data = await readMediaData(response)
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1].body))).toEqual({
      query_params: { artifact_id: '123', generate_id: 'abc' }
    })
    expect(data.media.map(item => item.type)).toEqual(['video', 'image'])
  })

  it('uses Kling work_id and decodes escaped resource URLs', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 200, result: 1, data: {
      resource: { resource: 'https:\\/\\/video.example.com\\/work.mp4' },
      firstFrame: { resource: 'https://image.example.com/first.jpg' }, userProfile: { userName: '作者', userId: 42 }
    } }))
    const response = await app().request(route('kling', 'https://klingai-share.kuaishou.com/h5-app/share?work_id=654321'), { headers })
    expect(response.status).toBe(200)
    const data = await readMediaData(response)
    const called = new URL(fetchMock.mock.calls[0]![0])
    expect(called.searchParams.get('creativeId')).toBe('654321')
    expect(called.searchParams.get('creativeType')).toBe('WORK')
    expect(data.media[0]?.url).toBe('https://video.example.com/work.mp4')
    expect(data).toMatchObject({ author: '作者', uid: '42', avatar: null })
    expect(data.title).toBeNull()
    expect(data.cover).toBe('https://image.example.com/first.jpg')
  })

  it('reads split Hailuo Flight data, retaining the AI label and excluding reference images', async () => {
    const stream = '21:T5,hello22:' + JSON.stringify(['$', 'div', null, {
      unrelated: '&quot;literal entity&quot;',
      video: { videoAsset: {
        desc: '中文提示词，包含 } 和 " 引号', userIDStr: '123',
        videoURL: 'https://cdn.hailuoai.com/brand.mp4',
        videoURLs: { downloadURLWithAIWatermark: 'https://cdn.hailuoai.com/ai.mp4' },
        originFiles: [{ url: 'https://cdn.hailuoai.com/input.jpg' }]
      } }
    }])
    const split = stream.indexOf('videoAsset') + 5
    const html = [stream.slice(0, split), stream.slice(split)]
      .map(chunk => '<script>self.__next_f.push(' + JSON.stringify([1, chunk]) + ')</script>').join('')
    fetchMock.mockResolvedValueOnce(new Response(html))
    const response = await app().request(route('hailuo', HAILUO), { headers })
    expect(response.status).toBe(200)
    const data = await readMediaData(response)
    expect(data.media).toEqual([{ type: 'video', url: 'https://cdn.hailuoai.com/ai.mp4', variant: 'download', watermark: 'ai-generated' }])
    expect(data).toMatchObject({ author: null, uid: '123', avatar: null })
    expect(data.title).toContain('中文')
  })

  it('falls back to Hailuo JSON-LD without claiming watermark removal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<script type="application/ld+json">' + JSON.stringify({
      '@graph': [{ '@type': ['VideoObject'], name: '视频', contentUrl: 'https://cdn.hailuoai.com/ld.mp4',
        thumbnailUrl: ['https://cdn.hailuoai.com/cover.jpg'] }]
    }) + '</script>'))
    const data = await parseAiMedia(HAILUO)
    expect(data.media[0]).toMatchObject({ variant: 'preview', watermark: 'unknown' })
    expect(data.cover).toBe('https://cdn.hailuoai.com/cover.jpg')
  })

  it('decodes nested Qianwen state and prioritizes download URLs for images and videos', async () => {
    const initial = { data: {
      title: '作品', creator: { nick: '作者', authorId: '123', avatar: 'https://image.example.com/avatar.png' },
      images: [{ url: 'https://image.example.com/preview.png', downloadUrl: 'https://image.example.com/raw.png?token=a%2Fb' }],
      playInfo: { url: 'https://video.example.com/preview.mp4', downloadUrl: 'https://video.example.com/download.mp4' }
    } }
    fetchMock.mockResolvedValueOnce(qianwenPage(encodeURIComponent(encodeURIComponent(JSON.stringify(initial)))))
    const response = await app().request(route('qianwen', QIANWEN), { headers })
    expect(response.status).toBe(200)
    const data = await readMediaData(response)
    expect(data).toMatchObject({ author: '作者', uid: '123', avatar: 'https://image.example.com/avatar.png' })
    expect(data.media.map(item => item.url)).toEqual([
      'https://image.example.com/raw.png?token=a%2Fb', 'https://video.example.com/download.mp4'
    ])
  })

  it('extracts Qianwen conversation media without collecting avatars or input queries', async () => {
    fetchMock.mockResolvedValueOnce(qianwenPage({ data: {
      creator: { avatar: { url: 'https://image.example.com/avatar.png' } },
      session: { record_list: [{ query: { text: '生成视频', url: 'https://image.example.com/input.png' },
        response: JSON.stringify([{ url: 'https://video.example.com/preview.mp4', downloadUrl: 'https://video.example.com/result.mp4' }]) }] }
    } }))
    const data = await parseAiMedia(QIANWEN)
    expect(data.media.map(item => item.url)).toEqual(['https://video.example.com/result.mp4'])
    expect(data.title).toBe('生成视频')
  })
})

describe('Doubao originals and fallbacks', () => {
  it('deciphers a fixed FPLAY AES-CBC vector and rejects invalid ciphertext', () => {
    expect(decipherFplayUrl(GOLDEN.encrypted, GOLDEN.seed)).toBe(GOLDEN.url)
    expect(decipherFplayUrl('invalid', GOLDEN.seed)).toBe('')
    expect(decipherFplayUrl(GOLDEN.encrypted, 'd3Jvbmc')).toBe('')
  })

  it('parses nested creation and attachment images without including profile pictures', async () => {
    const image = { image_ori_raw: { url: 'https://image.example.com/raw.png?signature=a%2Fb' }, image_ori: { url: 'https://image.example.com/preview.png' } }
    fetchMock.mockResolvedValueOnce(threadPage({ data: { message_list: [{
      content: JSON.stringify([{ title: '对话', creation_block: { creations: [{ image }] } },
        { content: { attachment_block: { attachments: [{ image }] } } }])
    }], profile: { image: { origin_url: 'https://image.example.com/avatar.png' } } } }))
    const response = await app().request(route('doubao', THREAD), { headers })
    expect(response.status).toBe(200)
    const data = await readMediaData(response)
    expect(data.media).toHaveLength(1)
    expect(data.media[0]).toMatchObject({ variant: 'original', watermark: 'none', url: 'https://image.example.com/raw.png?signature=a%2Fb' })
  })

  it('preserves CDN signatures and identifies public video previews as marked', async () => {
    fetchMock.mockResolvedValueOnce(publicDoubao())
    const data = await parseAiMedia(DOUBAO)
    expect(data.media[0]).toMatchObject({ variant: 'preview', watermark: 'present' })
    expect(data.media[0]?.url).toContain('lr=video_gen_watermark_dyn&token=a%2Fb')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).has('cookie')).toBe(false)
  })

  it('uses authenticated FPLAY originals and never forwards the cookie to the playback API', async () => {
    fetchMock.mockResolvedValueOnce(publicDoubao())
      .mockResolvedValueOnce(json({ code: 0, data: { results: [{
        video_model_result: { video_model: JSON.stringify({ fallback_api: 'https://ib.snssdk.com/video/play?key_seed=request-seed&logo_type=watermark&force_fids=old&token=keep' }) }
      }] } }))
      .mockResolvedValueOnce(json({ video_info: { data: { key_seed: GOLDEN.seed, video_list: {
        original: { main_url: GOLDEN.encrypted, vwidth: 1920, vheight: 1080 }
      } } } }))
    const data = await parseAiMedia(DOUBAO, { cookie: 'sessionid_ss=private-value' })
    expect(data.media[0]).toEqual({ type: 'video', url: GOLDEN.url, variant: 'original', watermark: 'none' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('cookie')).toBe('sessionid_ss=private-value')
    const fallback = fetchMock.mock.calls[2]!
    expect(new Headers(fallback[1].headers).has('cookie')).toBe(false)
    const endpoint = new URL(fallback[0])
    expect(endpoint.searchParams.has('logo_type')).toBe(false)
    expect(endpoint.searchParams.get('force_fids')).toBe('b3JpZ2luYWw=')
    expect(endpoint.searchParams.get('codec_type')).toBe('5')
    expect(endpoint.searchParams.get('token')).toBe('keep')
  })

  it('uses original_media_info after the model API fails', async () => {
    fetchMock.mockResolvedValueOnce(publicDoubao())
      .mockResolvedValueOnce(json({ code: 1 }))
      .mockResolvedValueOnce(json({ code: 0, data: { original_media_info: { main_url: GOLDEN.url } } }))
    const data = await parseAiMedia(DOUBAO, { cookie: 'sessionid_ss=test' })
    expect(data.media[0]).toMatchObject({ variant: 'original', watermark: 'none', url: GOLDEN.url })
  })

  it('retains the preview version and watermark state when the cookie expires', async () => {
    fetchMock.mockResolvedValueOnce(publicDoubao())
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(json({ code: 1 }))
    const data = await parseAiMedia(DOUBAO, { cookie: 'sessionid_ss=expired' })
    expect(data.media[0]).toMatchObject({ variant: 'preview', watermark: 'present' })
  })

  it('retains every distinct video in a conversation and decodes base64 model URLs', async () => {
    fetchMock.mockResolvedValueOnce(threadPage({ creations: [
      { video: { video_model: JSON.stringify({ video_list: { first: { main_url: Buffer.from(GOLDEN.url).toString('base64') } } }) } },
      { video: { vid: 'video2', download_url: 'https://video.example.com/second.mp4' } },
      { video: { vid: 'video2', download_url: 'https://video.example.com/second.mp4' } }
    ] }))
    const data = await parseAiMedia(THREAD)
    expect(data.media.map(item => item.url)).toEqual([GOLDEN.url, 'https://video.example.com/second.mp4'])
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('configuration and upstream failures', () => {
  it('publishes platform switches, validates options, and redacts every cookie', () => {
    const values = Object.fromEntries(AI_MEDIA_PLATFORMS.map(platform => ['aiMedia.' + platform + 'Cookie', 'secret-' + platform]))
    const manager = configuration(values)
    expect(manager.getValue('aiMedia.enabledPlatforms')).toEqual([...AI_MEDIA_PLATFORMS])
    for (const platform of AI_MEDIA_PLATFORMS) {
      expect(manager.getRedactedState().values['aiMedia.' + platform + 'Cookie']).toEqual({ configured: true })
    }
    expect(JSON.stringify(manager.getRedactedState())).not.toContain('secret-')
    expect(() => configuration({ 'aiMedia.enabledPlatforms': ['unknown'] })).toThrow()
    const fields = serviceConfigurationDefinition.groups.find(group => group.key === 'aiMedia')!.fields
    expect(fields.find(field => field.type === 'multi-select')!.options).toEqual([
      { value: 'doubao', label: '豆包' },
      { value: 'jimeng', label: '即梦' },
      { value: 'xiaoyunque', label: '小云雀' },
      { value: 'kling', label: '可灵' },
      { value: 'hailuo', label: '海螺' },
      { value: 'qianwen', label: '通义千问' }
    ])
    expect(fields.filter(field => field.type === 'secret').map(field => field.label))
      .toEqual(['豆包 Cookie', '即梦 Cookie', '小云雀 Cookie', '可灵 Cookie', '海螺 Cookie', '通义千问 Cookie'])
  })

  it('applies switches and cookies immediately to the same app', async () => {
    const manager = configuration({ 'aiMedia.enabledPlatforms': [] })
    const instance = app(manager)
    expect((await instance.request(route('jimeng', JIMENG), { headers })).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    await manager.apply(1, { ...manager.getSnapshot().values,
      'aiMedia.enabledPlatforms': ['jimeng'], 'aiMedia.jimengCookie': 'session=matching', 'aiMedia.doubaoCookie': 'session=other'
    })
    fetchMock.mockResolvedValueOnce(json({ ret: 0, data: { video: { origin_video: { video_url: GOLDEN.url } } } }))
    expect((await instance.request(route('jimeng', JIMENG), { headers })).status).toBe(200)
    expect(new Headers(fetchMock.mock.calls[0]?.[1].headers).get('cookie')).toBe('session=matching')
  })

  it.each([
    [new Response('not-json'), 502, 'UPSTREAM_INVALID_RESPONSE'],
    [new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024) } }), 502, 'UPSTREAM_INVALID_RESPONSE'],
    [new Response(null, { status: 404 }), 422, 'PARSE_FAILED'],
    [json({ ret: '0', data: { video: {} } }), 422, 'PARSE_FAILED']
  ])('maps bad upstream responses to stable errors', async (upstream, status, code) => {
    fetchMock.mockResolvedValueOnce(upstream)
    const response = await app().request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(status)
    expect(response.headers.get('x-openapi-error-code')).toBe(code)
    expect(await response.json()).toMatchObject({ code, data: null, timestamp: expect.any(Number) })
  })

  it('preserves Retry-After and stops Doubao fallbacks on rate limits', async () => {
    fetchMock.mockResolvedValueOnce(publicDoubao())
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '30' } }))
    const response = await app(configuration({ 'aiMedia.doubaoCookie': 'sessionid_ss=test' }))
      .request(route('doubao', DOUBAO), { headers })
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not expose upstream secrets in errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('cookie=secret upstream stack trace'))
    const response = await app().request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('secret')
  })

  it('honors cancellation without issuing a request', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(parseAiMedia(JIMENG, { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts the upstream request at the service deadline', async () => {
    let upstreamSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce(async (_input, options) => {
      upstreamSignal = options.signal
      return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }))
    })
    const response = await app(configuration(), 30).request(route('jimeng', JIMENG), { headers })
    expect(response.status).toBe(504)
    expect(response.headers.get('x-openapi-error-code')).toBe('REQUEST_TIMEOUT')
    expect(upstreamSignal?.aborted).toBe(true)
  })
})
