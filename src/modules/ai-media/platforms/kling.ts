import { mediaItem, mediaUrl, record, result, text } from '../common.js'
import { MOBILE_USER_AGENT, requestAiJson } from '../http.js'
import { AiMediaError, parseFailed, type AiMediaRequestOptions } from '../types.js'

export async function parseKling(source: URL, options: AiMediaRequestOptions) {
  const id = text(source.searchParams.get('creative_id'), source.searchParams.get('work_id'))
  const type = text(source.searchParams.get('creative_type'), 'WORK')
  if (!/^\d{1,64}$/.test(id) || !/^[A-Z_]{1,32}$/.test(type)) {
    throw new AiMediaError(400, 'INVALID_PARAMETER', '可灵分享链接缺少有效的作品参数')
  }
  const endpoint = new URL('https://klingai-share.kuaishou.com/app/creatives/query')
  endpoint.search = new URLSearchParams({ creativeId: id, creativeType: type }).toString()
  const payload = record(await requestAiJson('kling', endpoint, {
    ...options, userAgent: MOBILE_USER_AGENT, referer: 'https://klingai-share.kuaishou.com/'
  }))
  if (String(payload.status) !== '200' || String(payload.result) !== '1') throw parseFailed()
  const detail = record(payload.data)
  const user = record(detail.userProfile)
  const video = mediaItem('video', record(detail.resource).resource, 'download')
  return result({
    title: text(detail.introduction, '可灵AI 作品'),
    author: {
      name: text(user.userName), id: text(user.userId), avatar: mediaUrl(record(user.avatar).resource)
    },
    cover: mediaUrl(record(detail.cover).resource, record(detail.firstFrame).resource),
    media: video ? [video] : []
  })
}
