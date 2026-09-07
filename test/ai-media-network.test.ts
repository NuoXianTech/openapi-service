import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAiMedia } from '../src/modules/ai-media/index.js'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('undici', () => ({
  Agent: class { close() { return Promise.resolve() } },
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
}))

beforeEach(() => {
  mocks.lookup.mockReset()
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => vi.restoreAllMocks())

describe('AI media network boundaries', () => {
  it('rejects an upstream-provided FPLAY URL outside the allowlist before connecting', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 0, data: { play_info: { main: 'https://video.example.com/preview.mp4' } } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { results: [{
        video_model_result: { video_model: JSON.stringify({ fallback_api: 'https://attacker.example/private?key_seed=secret' }) }
      }] } }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { original_media_info: { main_url: 'https://video.example.com/original.mp4' } } }))
    const data = await parseAiMedia('https://www.doubao.com/video-sharing?share_id=1&video_id=vid', { cookie: 'sessionid_ss=private' })
    expect(data.media[0]?.watermark).toBe('none')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url] of fetchMock.mock.calls) expect(new URL(String(url)).hostname).toBe('www.doubao.com')
    expect(mocks.lookup.mock.calls.map(call => call[0])).not.toContain('attacker.example')
  })

  it('blocks short-link redirects outside the matching platform', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302, headers: { location: 'https://attacker.example/collect' }
    }))
    await expect(parseAiMedia('https://xiaoyunque.jianying.com/s/test/?t=123', { cookie: 'session=private' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mocks.lookup.mock.calls.map(call => call[0])).not.toContain('attacker.example')
  })

  it('strips cookies across allowed redirect origins and sends them only on the platform API request', async () => {
    const finalUrl = 'https://xiaoyunque.jianying.com/activities/pippit_share?artifact_id=123'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: finalUrl } }))
      .mockResolvedValueOnce(Object.defineProperty(new Response(''), 'url', { value: finalUrl }))
      .mockResolvedValueOnce(Response.json({ err_no: 0, data: { page_info: { generate_page: { item_info: {
        image_info: ['https://image.example.com/original.png']
      } } } } }))
    await parseAiMedia('https://xyq.jianying.com/s/test/', { cookie: 'session=private' })
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('cookie')).toBe('session=private')
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('cookie')).toBe(false)
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('cookie')).toBe('session=private')
  })

  it('blocks a trusted hostname that resolves to a private address', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    mocks.lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    await expect(parseAiMedia('https://activity.qianwen.com/share/test')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
