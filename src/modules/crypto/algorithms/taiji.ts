import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'
import { base64Decode, base64Encode } from './base64.js'

const TAIJI = '䷁䷗䷆䷒䷎䷣䷭䷊䷏䷲䷧䷵䷽䷶䷟䷡䷇䷂䷜䷻䷦䷾䷯䷄䷬䷐䷮䷹䷞䷰䷛䷪䷖䷚䷃䷨䷳䷕䷑䷙䷢䷔䷿䷥䷷䷝䷱䷍䷓䷩䷺䷼䷴䷤䷸䷈䷋䷘䷅䷉䷠䷌䷫䷀☯'
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

function createMapping(key?: string): (index: number) => number {
  if (!key) return index => index
  const state = Array.from({ length: 64 }, (_, index) => index)
  let second = 0
  const swap = (first: number, next: number) => {
    const value = state[first]!
    state[first] = state[next]!
    state[next] = value
  }
  for (let first = 0; first < 64; first++) {
    second = (second + state[first]!
      + key.charCodeAt(first % key.length)) % 64
    swap(first, second)
  }
  let first = 0
  second = 0
  return (index) => {
    if (index === 64) return 64
    first = (first + 1) % 64
    second = (second + state[first]!) % 64
    swap(first, second)
    return index ^ state[(state[first]! + state[second]!) % 64]!
  }
}

function taijiEncode(text: string, key?: string): string {
  const map = createMapping(key)
  return Array.from(base64Encode(text)).map((character) => {
    const index = BASE64.indexOf(character)
    if (index < 0) {
      throw createCryptoBusinessError('内部编码错误：Base64 字符越界')
    }
    return TAIJI[map(index)]!
  }).join('')
}

function taijiDecode(text: string, key?: string): string {
  const map = createMapping(key)
  const base64 = Array.from(text).map((character) => {
    const index = TAIJI.indexOf(character)
    if (index < 0) throw createCryptoBusinessError('密文包含非太极字符')
    return BASE64[map(index)]!
  }).join('')
  return base64Decode(base64)
}

registerCryptoAlgorithm({
  name: 'taiji',
  title: '太极编码',
  description: '把任意文本编码为六十四卦与太极字符。',
  summary: '把普通文本转换成六十四卦字符，也可以还原。',
  modes: ['encrypt', 'decrypt'],
  options: [{
    name: 'key',
    type: 'string',
    description: '可选密码；加解密必须使用相同密码。'
  }],
  exec({ mode, text, options }) {
    const key = (options.key as string | undefined) || undefined
    return {
      text: mode === 'encrypt'
        ? taijiEncode(text, key)
        : taijiDecode(text, key)
    }
  }
})
