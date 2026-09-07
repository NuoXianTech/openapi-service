// Protocol reference: ucmao/media-parser (MIT); see resources/licenses/media-parser.txt.
import { createDecipheriv, createHash } from 'node:crypto'
import { load } from 'cheerio'
import { array, decodeHtml, decodeJson, mediaItem, mediaUrl, record, records, result, text } from '../common.js'
import { requestAiJson, requestAiText } from '../http.js'
import { AiMediaError, parseFailed } from '../types.js'
import type { AiMediaItem, AiMediaRequestOptions } from '../types.js'

const ORIGIN = 'https://www.doubao.com'
const FPLAY_HOSTS = ['doubao.com', 'snssdk.com', 'bytedanceapi.com', 'bytevod.com', 'volcvod.com']
const FPLAY_SALT = Buffer.from('TdTC5rgxYgkOUrPHpnM7pByyRiuCmrWKGWs521cXdST0m69/COjWjSanLjfBqVovHwWlGJKu8pSXMrYqOKrdWA==', 'base64')
const WEB_PARAMS = new URLSearchParams({
  version_code: '20800', language: 'zh-CN', device_platform: 'web', aid: '497858',
  real_aid: '497858', pkg_type: 'release_version', samantha_web: '1', 'use-olympus-account': '1'
})

function base64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || !value || value.length > 65_536 || !/^[\w+/-]+={0,2}$/.test(value)) return undefined
  return Buffer.from(value, 'base64url')
}

function decodedUrl(value: unknown): string {
  return mediaUrl(value, base64(value)?.toString('utf8'))
}

export function decipherFplayUrl(encrypted: unknown, keySeed: unknown): string {
  const data = base64(encrypted)
  const seed = base64(keySeed)
  if (!data || !seed?.length || data.length < 20 || (data.length - 4) % 16 !== 0) return ''
  try {
    const first = createHash('sha512').update(seed).digest()
    const derived = createHash('sha512').update(first).update(FPLAY_SALT).digest()
    const cipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
    return mediaUrl(Buffer.concat([cipher.update(data.subarray(4)), cipher.final()]).toString('utf8'))
  } catch { return '' }
}

async function optional<T>(operation: () => Promise<T>, options: AiMediaRequestOptions): Promise<T | undefined> {
  try { return await operation() } catch (error) {
    options.signal?.throwIfAborted()
    // Do not amplify rate limits by trying further API fallbacks.
    if (error instanceof AiMediaError && error.status === 503) throw error
    return undefined
  }
}

function renditions(value: unknown): Record<string, unknown>[] {
  const entries = (Array.isArray(value) ? value : Object.values(record(value))).map(record)
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
  return entries.sort((a, b) => (
    number(b.vwidth ?? b.width) * number(b.vheight ?? b.height)
      - number(a.vwidth ?? a.width) * number(a.vheight ?? a.height)
    || number(b.bitrate ?? b.bit_rate) - number(a.bitrate ?? a.bit_rate)
  ))
}

async function fplayVideo(fallback: unknown, options: AiMediaRequestOptions): Promise<AiMediaItem | undefined> {
  if (typeof fallback !== 'string') return undefined
  let endpoint: URL
  try { endpoint = new URL(fallback) } catch { return undefined }
  if (!endpoint.searchParams.has('key_seed')) return undefined
  for (const original of [true, false]) {
    const candidate = new URL(endpoint)
    candidate.protocol = 'https:'
    candidate.searchParams.delete('logo_type')
    candidate.searchParams.delete('force_fids')
    candidate.searchParams.set('codec_type', original ? '5' : '1')
    if (original) candidate.searchParams.set('force_fids', Buffer.from('original').toString('base64'))
    const payload = record(await optional(() => requestAiJson('doubao', candidate, {
      signal: options.signal, referer: `${ORIGIN}/`, allowedHosts: FPLAY_HOSTS
    }), options))
    const data = record(record(payload.video_info).data)
    for (const video of renditions(data.video_list)) {
      const url = mediaUrl(
        decipherFplayUrl(video.main_url, data.key_seed),
        decipherFplayUrl(video.backup_url_1, data.key_seed)
      )
      const item = mediaItem('video', url, 'original', original ? 'none' : 'unknown')
      if (item && item.watermark !== 'present') return item
    }
  }
  return undefined
}

interface VideoResult { item?: AiMediaItem, cover: string }

async function originalVideo(vid: string, source: URL, options: AiMediaRequestOptions): Promise<VideoResult> {
  if (!options.cookie?.trim()) return { cover: '' }
  let cover = ''
  const modelPayload = record(await optional(() => requestAiJson('doubao', `${ORIGIN}/alice/resource/get_video_model`, {
    ...options, referer: source.href, body: { params: [{ uri: vid }] }
  }), options))
  if (String(modelPayload.code) === '0') {
    const entry = record(array(record(modelPayload.data).results)[0])
    const model = record(decodeJson(record(entry.video_model_result).video_model))
    cover = mediaUrl(record(entry.video_url_result).poster_url, model.poster_url)
    const item = await fplayVideo(model.fallback_api, options)
    if (item?.watermark === 'none') return { item, cover }
    // Prefer the explicit original-media field over an unverified codec fallback.
    const play = await playInfo(vid, source, options)
    return play.item ? { ...play, cover: play.cover || cover } : { ...(item ? { item } : {}), cover }
  }
  return playInfo(vid, source, options)
}

async function playInfo(vid: string, source: URL, options: AiMediaRequestOptions): Promise<VideoResult> {
  const payload = record(await optional(() => requestAiJson('doubao', `${ORIGIN}/samantha/media/get_play_info?${WEB_PARAMS}`, {
    ...options, referer: source.href, body: { key: vid }
  }), options))
  if (String(payload.code) !== '0') return { cover: '' }
  const data = record(payload.data)
  const item = mediaItem('video', decodedUrl(record(data.original_media_info).main_url), 'original', 'none')
  return { ...(item ? { item } : {}), cover: mediaUrl(data.poster_url) }
}

function imageFromCreation(image: Record<string, unknown>): AiMediaItem | undefined {
  const raw = mediaUrl(record(image.image_ori_raw).url, record(image.image_raw).url, image.raw_url, image.origin_url)
  return raw ? mediaItem('image', raw, 'original', 'none') : mediaItem('image', mediaUrl(
    record(image.image_ori).url, record(image.image_origin).url, image.url
  ), 'preview')
}

function embeddedVideo(video: Record<string, unknown>): AiMediaItem | undefined {
  const candidates: AiMediaItem[] = []
  const download = mediaItem('video', video.download_url, 'download')
  if (download) candidates.push(download)
  const model = record(decodeJson(video.video_model))
  for (const item of renditions(model.video_list)) {
    const candidate = mediaItem('video', decodedUrl(item.main_url) || decodedUrl(item.backup_url_1), 'preview')
    if (candidate) candidates.push(candidate)
  }
  return candidates.find(item => item.watermark !== 'present') ?? candidates[0]
}

function videoWarnings(media: AiMediaItem[], options: AiMediaRequestOptions): string[] {
  if (!media.some(item => item.type === 'video' && item.watermark !== 'none')) return []
  return [options.cookie?.trim()
    ? '部分豆包视频未取得已确认的无水印原片，请检查 Cookie 有效性和作品访问权限。'
    : '豆包原视频通常需要配置 aiMedia.doubaoCookie；当前返回公开版本，水印状态以各媒体字段为准。']
}

async function parseThread(source: URL, options: AiMediaRequestOptions) {
  const html = await requestAiText('doubao', source, options)
  const $ = load(html)
  const roots: unknown[] = $('script[data-fn-args]').toArray().map(script => decodeJson($(script).attr('data-fn-args')))
  // Router attributes may contain double-escaped JSON that HTML parsers truncate.
  for (const match of html.matchAll(/<script\b[^>]*\bdata-fn-name="r"[^>]*\bdata-fn-args="(.*?)"\s+nonce=/gs)) {
    roots.push(decodeJson(decodeHtml(match[1] ?? '')))
  }
  const nodes = [...records(roots)]
  const creations = nodes.flatMap(node => array(node.creations)).map(record)
  const media: AiMediaItem[] = []
  const videos = new Map<string, Record<string, unknown>>()
  let cover = ''
  for (const node of nodes) {
    const nested = record(node.image)
    const images = [
      ...array(node.ref_images),
      ...array(node.ref_resources).map(item => record(item).image),
      ...array(record(node.attachment_block).attachments).map(item => record(item).image),
      ...(nested.image_ori_raw || nested.image_raw ? [nested] : [])
    ]
    for (const image of images) {
      const item = imageFromCreation(record(image))
      if (item) media.push(item)
    }
  }
  for (const creation of creations) {
    const image = imageFromCreation(record(creation.image))
    if (image) media.push(image)
    const video = record(creation.video)
    if (Object.keys(video).length) {
      const vid = text(video.vid, video.video_id)
      const key = vid || text(video.download_url, video.video_model) || String(videos.size)
      if (!videos.has(key)) videos.set(key, video)
    }
  }
  for (const video of videos.values()) {
    options.signal?.throwIfAborted()
    const vid = text(video.vid, video.video_id)
    const original = vid ? await originalVideo(vid, source, options) : { cover: '' }
    const item = original.item ?? embeddedVideo(video)
    if (item) media.push(item)
    cover ||= mediaUrl(original.cover, video.poster_url, record(video.cover).url,
      record(record(video.cover).image_thumb).url, record(video.poster).url)
  }
  if (!media.length && videos.size && !options.cookie?.trim()) {
    throw new AiMediaError(422, 'AI_MEDIA_AUTH_REQUIRED', '该豆包视频需要配置有效的 aiMedia.doubaoCookie')
  }
  const title = ['title', 'prompt', 'description'].map(key => text(...nodes.map(node => node[key]))).find(Boolean) ?? ''
  const author = nodes.find(node => text(node.nickname, node.user_name)) ?? {}
  return result({
    title: title || '豆包对话分享',
    author: { name: text(author.nickname, author.user_name), id: text(author.user_id, author.uid, author.id), avatar: mediaUrl(author.avatar, author.avatar_url) },
    cover, media, warnings: videoWarnings(media, options)
  })
}

async function parseVideoSharing(source: URL, options: AiMediaRequestOptions) {
  const shareId = text(source.searchParams.get('share_id'))
  const vid = text(source.searchParams.get('video_id'))
  if (!/^[\w-]{1,128}$/.test(shareId) || !/^[\w-]{1,128}$/.test(vid)) {
    throw new AiMediaError(400, 'INVALID_PARAMETER', '豆包视频分享链接必须包含 share_id 和 video_id')
  }
  const payload = record(await requestAiJson('doubao', `${ORIGIN}/creativity/share/get_video_share_info?${WEB_PARAMS}`, {
    ...options, referer: source.href, body: { share_id: shareId, vid, creation_id: '' }
  }))
  if (String(payload.code) !== '0') throw parseFailed()
  const detail = record(payload.data)
  const play = record(detail.play_info)
  const user = record(detail.user_info)
  const original = await originalVideo(vid, source, options)
  const item = original.item ?? mediaItem('video', decodedUrl(play.main) || decodedUrl(play.backup), 'preview', 'present')
  const media = item ? [item] : []
  return result({
    title: text(detail.prompt, '豆包 AI 视频'),
    author: { name: text(user.nickname, user.user_name), id: text(user.user_id), avatar: mediaUrl(user.avatar, user.avatar_url) },
    cover: mediaUrl(original.cover, play.poster_url), media, warnings: videoWarnings(media, options)
  })
}

export async function parseDoubao(source: URL, options: AiMediaRequestOptions) {
  if (/^\/thread\/[^/]+\/?$/.test(source.pathname)) return parseThread(source, options)
  if (source.pathname.replace(/\/$/, '') === '/video-sharing') return parseVideoSharing(source, options)
  throw new AiMediaError(400, 'INVALID_PARAMETER', '请提供豆包对话或视频分享链接')
}
