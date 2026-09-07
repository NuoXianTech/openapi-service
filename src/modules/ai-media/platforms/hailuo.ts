import { load } from 'cheerio'
import { jsonAt, mediaItem, mediaUrl, record, records, result, text } from '../common.js'
import { requestAiText } from '../http.js'
import { AiMediaError, parseFailed, type AiMediaRequestOptions } from '../types.js'

function flightAsset(html: string): Record<string, unknown> | undefined {
  const $ = load(html)
  const chunks: string[] = []
  for (const script of $('script').toArray()) {
    const content = $(script).text()
    for (const match of content.matchAll(/self\.__next_f\.push\(\s*/g)) {
      const push = jsonAt(content, match.index + match[0].length)
      if (Array.isArray(push) && push[0] === 1 && typeof push[1] === 'string') chunks.push(push[1])
    }
  }
  // Flight rows can be split across script tags; decode after joining them.
  const stream = chunks.join('')
  // Length-prefixed Flight text rows need not end in a newline. Locate the
  // JSON field directly instead of assuming every row starts on a new line.
  for (const content of [stream, html]) {
    for (const match of content.matchAll(/"videoAsset"\s*:\s*/g)) {
      const asset = record(jsonAt(content, match.index + match[0].length))
      if (asset.videoURLs || asset.downloadURL || asset.videoURL) return asset
    }
  }
  return undefined
}

export async function parseHailuo(source: URL, options: AiMediaRequestOptions) {
  if (!/^\/share\/ai-video\/[^/]+\/?$/.test(source.pathname)) {
    throw new AiMediaError(400, 'INVALID_PARAMETER', '请提供海螺 AI 视频分享链接')
  }
  const html = await requestAiText('hailuo', source, options)
  const asset = flightAsset(html)
  if (asset) {
    const urls = record(asset.videoURLs)
    const video = mediaItem('video', urls.downloadURLWithAIWatermark, 'download', 'ai-generated')
      ?? mediaItem('video', asset.downloadURL, 'download')
      ?? mediaItem('video', asset.videoURL, 'preview', 'present')
      ?? mediaItem('video', urls.downloadURLWithHailuoWatermark, 'preview', 'present')
    if (video) return result({
      title: text(asset.title, asset.desc, '海螺AI 作品'),
      author: { name: '', id: text(asset.userIDStr, asset.userID), avatar: '' },
      cover: mediaUrl(asset.coverURL, asset.promptImgURL), media: [video],
      warnings: video.watermark === 'ai-generated' ? ['已优先选择去品牌水印版本，仍保留 AI 生成角标。'] : []
    })
  }
  const $ = load(html)
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    for (const node of records($(script).text())) {
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
      if (!types.includes('VideoObject')) continue
      const video = mediaItem('video', node.contentUrl, 'preview')
      if (!video) continue
      return result({
        title: text(node.description, node.name, '海螺AI 作品'),
        author: { name: text(record(node.author).name), id: '', avatar: '' },
        cover: mediaUrl(node.thumbnailUrl, ...(Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl : [])),
        media: [video]
      })
    }
  }
  throw parseFailed()
}
