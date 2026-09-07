import { mediaItem, mediaUrl, record, result, text } from '../common.js'
import { requestAiJson, resolveAiUrl } from '../http.js'
import { AiMediaError, parseFailed, type AiMediaRequestOptions } from '../types.js'

function itemId(url: URL): string {
  return text(url.searchParams.get('item_id'), url.searchParams.get('id'), url.pathname.match(/\/(\d+)\/?$/)?.[1])
}

export async function parseJimeng(source: URL, options: AiMediaRequestOptions) {
  let id = itemId(source)
  if (!id && (source.pathname.includes('/s/') || !source.hostname.endsWith('jianying.com'))) {
    id = itemId(await resolveAiUrl('jimeng', source, options))
  }
  if (!/^\d{1,64}$/.test(id)) throw new AiMediaError(400, 'INVALID_PARAMETER', '即梦分享链接缺少有效的作品 ID')

  const payload = record(await requestAiJson('jimeng', 'https://jimeng.jianying.com/mweb/v1/get_item_info', {
    ...options, referer: source.href, body: { published_item_id: id }
  }))
  if (String(payload.ret) !== '0') throw parseFailed()
  const detail = record(payload.data)
  const common = record(detail.common_attr)
  const author = record(detail.author)
  const video = record(detail.video)
  const transcoded = record(video.transcoded_video)
  const original = mediaUrl(record(transcoded.origin).video_url, record(video.origin_video).video_url)
  const quality = (value: Record<string, unknown>) => {
    const number = (field: unknown) => Number.isFinite(Number(field)) ? Math.max(0, Number(field)) : 0
    return [number(value.width) * number(value.height), number(value.br ?? value.bitrate)]
  }
  const alternatives = Object.values(transcoded).map(record)
    .filter(item => mediaUrl(item.video_url))
    .sort((a, b) => quality(b)[0]! - quality(a)[0]! || quality(b)[1]! - quality(a)[1]!)
  const selected = original
    ? mediaItem('video', original, 'original', 'none')
    : mediaItem('video', alternatives[0]?.video_url, 'preview')
  const covers = record(common.cover_url_map)
  return result({
    title: text(common.description, '即梦AI 作品'),
    author: { name: text(author.name), id: text(author.uid, author.sec_uid), avatar: mediaUrl(author.avatar_url) },
    cover: mediaUrl(covers.original, ...['4096', '2400', '1080', '720', '480', '360'].map(key => covers[key]),
      ...Object.values(covers), common.cover_url, video.cover_url),
    media: selected ? [selected] : []
  })
}
