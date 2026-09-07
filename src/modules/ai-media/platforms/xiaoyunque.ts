import { array, mediaItem, mediaUrl, record, result, text } from '../common.js'
import { requestAiJson, resolveAiUrl } from '../http.js'
import { AiMediaError, parseFailed, type AiMediaItem, type AiMediaRequestOptions } from '../types.js'

export async function parseXiaoyunque(source: URL, options: AiMediaRequestOptions) {
  // Tracking parameters on a short link do not contain the landing-page IDs.
  const resolved = source.pathname.includes('/s/')
    ? await resolveAiUrl('xiaoyunque', source, options)
    : source
  if (!resolved.searchParams.size) {
    throw new AiMediaError(400, 'INVALID_PARAMETER', '小云雀分享链接缺少作品参数')
  }
  const query: Record<string, string> = Object.fromEntries(resolved.searchParams)
  const payload = record(await requestAiJson('xiaoyunque',
    'https://xiaoyunque.jianying.com/luckycat/cn/jianying/campaign/v1/pippit/share/landing_page', {
      ...options, referer: resolved.href, body: { query_params: query }
    }))
  if (String(payload.err_no) !== '0') throw parseFailed()
  const page = record(record(record(payload.data).page_info).generate_page)
  const item = record(page.item_info)
  const user = record(page.user_info)
  const media: AiMediaItem[] = []
  const videoInfo = record(item.video_info)
  const video = mediaItem('video', mediaUrl(item.video_url, item.video_play_url, videoInfo.main_url, videoInfo.video_url), 'download')
  if (video) media.push(video)
  for (const image of array(item.image_info)) {
    const entry = mediaItem('image', typeof image === 'string' ? image : record(image).image_url, 'download')
    if (entry) media.push(entry)
  }
  return result({
    title: text(item.desc, item.title, '小云雀AI 作品'),
    author: { name: text(user.nick_name), id: text(user.user_id, user.sec_uid), avatar: mediaUrl(user.avatar_url) },
    cover: mediaUrl(item.cover_url), media
  })
}
