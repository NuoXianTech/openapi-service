import {
  ARTPLAYER_LANGS,
  ARTPLAYER_TYPES,
  DPLAYER_LANGS,
  DPLAYER_TYPES,
  type ArtplayerOptions,
  type DplayerOptions
} from './types.js'

function enumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const normalized = value?.trim().toLowerCase() ?? ''
  return allowed.includes(normalized as T) ? normalized as T : fallback
}

function httpURL(value: string | undefined, required: true): string | null
function httpURL(value: string | undefined, required?: false): string
function httpURL(value: string | undefined, required = false): string | null {
  const raw = value?.trim() ?? ''
  if (!raw) return required ? null : ''
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? raw
      : required ? null : ''
  } catch {
    return required ? null : ''
  }
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function volumeValue(value: string | undefined): number {
  const volume = Number(value)
  return Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 0.7
}

export function parseDplayerOptions(
  query: Record<string, string | undefined>
): DplayerOptions | null {
  const url = httpURL(query.url, true)
  if (!url) return null
  return {
    url,
    type: enumValue(query.type, DPLAYER_TYPES, 'auto'),
    cover: httpURL(query.cover),
    live: booleanValue(query.live, false),
    muted: booleanValue(query.muted, false),
    autoplay: booleanValue(query.autoplay, false),
    hideplay: booleanValue(query.hideplay, false),
    loop: booleanValue(query.loop, false),
    lang: enumValue(query.lang, DPLAYER_LANGS, 'zh-cn'),
    volume: volumeValue(query.volume)
  }
}

export function parseArtplayerOptions(
  query: Record<string, string | undefined>
): ArtplayerOptions | null {
  const url = httpURL(query.url, true)
  if (!url) return null
  const theme = query.theme?.trim() ?? ''
  return {
    id: query.id?.trim() ?? '',
    url,
    type: enumValue(query.type, ARTPLAYER_TYPES, ''),
    lang: enumValue(query.lang, ARTPLAYER_LANGS, 'zh-cn'),
    poster: httpURL(query.poster),
    theme: /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(theme) ? theme : '#f00',
    volume: volumeValue(query.volume),
    islive: booleanValue(query.islive, false),
    muted: booleanValue(query.muted, false),
    autoplay: booleanValue(query.autoplay, false),
    autoplayback: booleanValue(query.autoplayback, false),
    hideplay: booleanValue(query.hideplay, false),
    automini: booleanValue(query.automini, false),
    loop: booleanValue(query.loop, false),
    flip: booleanValue(query.flip, true),
    playbackrate: booleanValue(query.playbackrate, true),
    aspectratio: booleanValue(query.aspectratio, true),
    setting: booleanValue(query.setting, true),
    hotkey: booleanValue(query.hotkey, true),
    pip: booleanValue(query.pip, true),
    mutex: booleanValue(query.mutex, true),
    fullscreen: booleanValue(query.fullscreen, true),
    fullscreenweb: booleanValue(query.fullscreenweb, false),
    miniprogressbar: booleanValue(query.miniprogressbar, false),
    playsinline: booleanValue(query.playsinline, true)
  }
}
