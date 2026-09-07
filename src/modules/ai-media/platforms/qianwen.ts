import { array, assignedJson, decodeJson, identifier, isRecord, mediaItem, mediaUrl, record, result, text } from '../common.js'
import { MOBILE_USER_AGENT, requestAiText } from '../http.js'
import { parseFailed, type AiMediaItem, type AiMediaRequestOptions } from '../types.js'

function inferredType(url: string): AiMediaItem['type'] | undefined {
  let path = new URL(url).pathname.toLowerCase()
  try { path = decodeURIComponent(path) } catch { /* Inspect the encoded path. */ }
  if (/\.(mp4|mov|m4v|webm)(?:$|[~/])|\/video\//.test(path)) return 'video'
  if (/\.(jpg|jpeg|png|webp|gif)(?:$|[~/])/.test(path)) return 'image'
  return undefined
}

function extractMedia(root: unknown): AiMediaItem[] {
  const media: AiMediaItem[] = []
  const pending = [{ value: root, depth: 0 }]
  const excluded = new Set(['creator', 'author', 'avatar', 'user', 'query', 'ref_images', 'ref_resources', 'originFiles'])
  let visited = 0
  while (pending.length && visited++ < 30_000) {
    const { value: raw, depth } = pending.pop()!
    if (depth > 32) continue
    const value = typeof raw === 'string' ? decodeJson(raw) : raw
    if (Array.isArray(value)) {
      for (const item of [...value].reverse()) pending.push({ value: item, depth: depth + 1 })
    } else if (isRecord(value)) {
      // Choose one rendition per object, so previews do not duplicate downloads.
      const download = mediaUrl(value.downloadUrl)
      const url = download || mediaUrl(value.playUrl, value.url)
      const type = url ? inferredType(url) : undefined
      const item = type ? mediaItem(type, url, download ? 'download' : 'preview') : undefined
      if (item) media.push(item)
      for (const [key, child] of Object.entries(value).reverse()) {
        if (!excluded.has(key)) pending.push({ value: child, depth: depth + 1 })
      }
    }
  }
  return media
}

export async function parseQianwen(source: URL, options: AiMediaRequestOptions) {
  const html = await requestAiText('qianwen', source, { ...options, userAgent: MOBILE_USER_AGENT })
  const props = record(assignedJson(html, 'window.__INITIAL_PROPS__'))
  const initial = record(decodeJson(props.initialData))
  const detail = isRecord(initial.data) ? initial.data : initial
  if (!Object.keys(detail).length) throw parseFailed()
  const session = record(detail.session)
  const query = record(array(session.record_list)[0]).query
  const creator = record(detail.creator ?? record(detail.content).creator)
  const media: AiMediaItem[] = []
  const images = array(detail.images).length ? array(detail.images) : detail.image ? [detail.image] : []
  for (const image of images) {
    const entry = record(image)
    const download = mediaUrl(entry.downloadUrl)
    const item = mediaItem('image', download || mediaUrl(entry.url, image), download ? 'download' : 'preview')
    if (item) media.push(item)
  }
  const play = record(detail.playInfo)
  const download = mediaUrl(play.downloadUrl)
  const video = mediaItem('video', download || mediaUrl(play.url), download ? 'download' : 'preview')
  if (video) media.push(video)
  const extracted = extractMedia(detail)
  for (const type of ['image', 'video'] as const) {
    if (!media.some(item => item.type === type)) media.push(...extracted.filter(item => item.type === type))
  }
  return result({
    title: text(detail.title, detail.shareSubtitle, detail.shareTitle, session.title,
      typeof query === 'string' ? query : text(record(query).content, record(query).text)),
    author: text(creator.nick), uid: identifier(creator.authorId, creator.uid), avatar: mediaUrl(creator.avatar),
    media
  })
}
