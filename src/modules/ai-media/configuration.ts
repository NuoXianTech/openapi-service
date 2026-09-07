import type { ConfigurationGroup } from '../../configuration/types.js'
import { AI_MEDIA_LABELS, AI_MEDIA_PLATFORMS } from './types.js'

export const aiMediaConfigurationGroup = {
  key: 'aiMedia', label: 'AI 媒体解析',
  description: '提取 AI 创作平台的原图、原视频和下载地址。',
  fields: [
    {
      key: 'aiMedia.enabledPlatforms', type: 'multi-select', label: '可用 AI 创作平台',
      description: '未选中的平台不会接受解析请求。', default: [...AI_MEDIA_PLATFORMS],
      options: AI_MEDIA_PLATFORMS.map(platform => ({ value: platform, label: AI_MEDIA_LABELS[platform] }))
    },
    ...AI_MEDIA_PLATFORMS.map(platform => ({
      key: `aiMedia.${platform}Cookie`, type: 'secret' as const,
      label: `${AI_MEDIA_LABELS[platform]} Cookie`,
      description: platform === 'doubao'
        ? '豆包原视频通常需要有效登录态，可填写 sessionid_ss=...；未配置时仍可解析公开图片和视频预览。'
        : '可选的平台登录态，只接受 Platform 加密下发。',
      placeholder: '粘贴对应平台 Cookie 字符串', maxLength: 12_000
    }))
  ]
} as const satisfies ConfigurationGroup
