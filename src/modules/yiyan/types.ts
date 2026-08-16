export interface YiyanSentence {
  id: number
  yiyan: string
  type: string
  from: string | null
  from_who: string | null
  created_at: string
  length: number
}

export interface YiyanRecord {
  id: string
  yiyan: string
  type: string
  from: string | null
  from_who: string | null
  created_at: string
  length: number
}

const YIYAN_TYPE_LABELS = {
  a: '动画',
  b: '漫画',
  c: '游戏',
  d: '文学',
  e: '原创',
  f: '影视',
  g: '诗词',
  h: '哲学',
  i: 'v50文案',
  n: '其他',
  z: '来自网络'
} as const

export type YiyanType = keyof typeof YIYAN_TYPE_LABELS
export type YiyanEncode = 'text' | 'json' | 'js' | 'md'
export type YiyanCharset = 'utf-8' | 'gbk'

export const DEFAULT_YIYAN_TYPE: YiyanType = 'a'
export const DEFAULT_YIYAN_ENCODE: YiyanEncode = 'json'
export const DEFAULT_YIYAN_CHARSET: YiyanCharset = 'utf-8'
export const DEFAULT_YIYAN_SELECT = '.yiyan'
export const DEFAULT_MIN_LENGTH = 0
export const DEFAULT_MAX_LENGTH = 30

export function isYiyanType(value: string): value is YiyanType {
  return Object.hasOwn(YIYAN_TYPE_LABELS, value)
}

export function isYiyanEncode(value: string): value is YiyanEncode {
  return value === 'text' || value === 'json' || value === 'js' || value === 'md'
}
