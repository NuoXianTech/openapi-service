export const DPLAYER_TYPES = ['auto', 'hls', 'flv', 'dash', 'normal'] as const
export const DPLAYER_LANGS = ['en', 'zh-cn', 'zh-tw', 'ko-kr', 'de', 'ja', 'ru'] as const
export const ARTPLAYER_TYPES = ['', 'm3u8', 'flv', 'mpd'] as const
export const ARTPLAYER_LANGS = ['en', 'zh-cn'] as const

export interface DplayerOptions {
  url: string
  type: typeof DPLAYER_TYPES[number]
  cover: string
  live: boolean
  muted: boolean
  autoplay: boolean
  hideplay: boolean
  loop: boolean
  lang: typeof DPLAYER_LANGS[number]
  volume: number
}

export interface ArtplayerOptions {
  id: string
  url: string
  type: typeof ARTPLAYER_TYPES[number]
  lang: typeof ARTPLAYER_LANGS[number]
  poster: string
  theme: string
  volume: number
  islive: boolean
  muted: boolean
  autoplay: boolean
  autoplayback: boolean
  hideplay: boolean
  automini: boolean
  loop: boolean
  flip: boolean
  playbackrate: boolean
  aspectratio: boolean
  setting: boolean
  hotkey: boolean
  pip: boolean
  mutex: boolean
  fullscreen: boolean
  fullscreenweb: boolean
  miniprogressbar: boolean
  playsinline: boolean
}
