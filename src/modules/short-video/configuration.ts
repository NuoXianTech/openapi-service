import type { ConfigurationGroup } from '../../configuration/types.js'
import { SHORT_VIDEO_PLATFORMS, type ShortVideoPlatform } from './types.js'

const labels: Record<ShortVideoPlatform, string> = {
  douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书',
  bilibili: '哔哩哔哩', weibo: '微博', pipixia: '皮皮虾',
  pipigx: '皮皮搞笑', toutiao: '今日头条'
}
export const shortVideoConfigurationGroup = {
  key: 'shortVideo', label: '短视频解析', description: '控制短视频平台及其登录态。',
  fields: [
    {
      key: 'shortVideo.enabledPlatforms', type: 'multi-select', label: '可用短视频平台',
      description: '未选中的平台不会接受解析请求。', default: [...SHORT_VIDEO_PLATFORMS],
      options: SHORT_VIDEO_PLATFORMS.map(platform => ({ value: platform, label: labels[platform] }))
    },
    ...SHORT_VIDEO_PLATFORMS.map(platform => ({
      key: `shortVideo.${platform}Cookie`, type: 'secret' as const,
      label: `${labels[platform]} Cookie`,
      description: '用于提升解析成功率或访问登录后可见内容，只接受 Platform 加密下发。',
      placeholder: '粘贴完整 Cookie 字符串', maxLength: 12_000
    }))
  ]
} as const satisfies ConfigurationGroup
