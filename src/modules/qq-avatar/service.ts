const SIZES = [40, 100, 140, 640] as const
export type QqAvatarSize = typeof SIZES[number]

export function normalizeQqNumber(value: string): string | null {
  const qq = value.trim()
  return /^[1-9][0-9]{4,11}$/.test(qq) ? qq : null
}

export function parseQqAvatarSize(value: string): QqAvatarSize | null {
  const normalized = value.trim()
  if (!normalized) return 100
  return SIZES.find(size => String(size) === normalized) ?? null
}

export function parseQqAvatarOutputType(
  value: string
): 'json' | 'image' | null {
  const type = value.trim().toLowerCase()
  if (!type || type === 'json') return 'json'
  return type === 'image' ? 'image' : null
}

export function createQqAvatarData(qq: string, size: QqAvatarSize) {
  const url = new URL('https://q1.qlogo.cn/g')
  url.searchParams.set('b', 'qq')
  url.searchParams.set('nk', qq)
  url.searchParams.set('s', String(size))
  return { qq, size, url: url.toString() }
}
