import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { ConfigurationGroup } from '../../configuration/types.js'
import { MUSIC_PLATFORMS, type MusicPlatform } from './types.js'

const labels: Record<MusicPlatform, string> = {
  netease: '网易云音乐', tencent: 'QQ 音乐', kugou: '酷狗音乐',
  baidu: '千千音乐', kuwo: '酷我音乐'
}
export const musicConfigurationGroup = {
  key: 'music', label: '音乐解析', description: '控制音乐平台及其登录态。',
  fields: [
    {
      key: 'music.enabledPlatforms', type: 'multi-select', label: '可用音乐平台',
      description: '未选中的平台不会接受调用。', default: [...MUSIC_PLATFORMS],
      options: MUSIC_PLATFORMS.map(platform => ({ value: platform, label: labels[platform] }))
    },
    ...MUSIC_PLATFORMS.map(platform => ({
      key: `music.${platform}Cookie`, type: 'secret' as const,
      label: `${labels[platform]} Cookie`,
      description: '用于登录态或会员资源请求，只接受 Platform 加密下发。',
      placeholder: '粘贴完整 Cookie 字符串', maxLength: 12_000
    }))
  ]
} as const satisfies ConfigurationGroup

let configuration: ServiceConfigurationManager | null = null
export function bindMusicConfiguration(manager: ServiceConfigurationManager): void {
  configuration = manager
}
function manager(): ServiceConfigurationManager {
  if (!configuration) throw new Error('music configuration is not bound')
  return configuration
}
export function enabledMusicPlatforms(): Set<string> {
  return new Set(manager().getValue<string[]>('music.enabledPlatforms'))
}
export function getMusicPlatformCookie(platform: MusicPlatform): Promise<string> {
  return Promise.resolve(manager().getValue<string>(`music.${platform}Cookie`))
}
