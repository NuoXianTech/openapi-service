import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

export function base64Encode(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

export function base64Decode(text: string): string {
  const trimmed = text.trim()
  if (!/^[A-Za-z0-9+/=\s]*$/.test(trimmed)) {
    throw createCryptoBusinessError('输入不是合法的 Base64 字符串')
  }
  return Buffer.from(trimmed, 'base64').toString('utf8')
}

registerCryptoAlgorithm({
  name: 'base64',
  title: 'Base64',
  description: 'UTF-8 文本与 Base64 的标准互转。',
  summary: '在普通文本和 Base64 字符串之间转换。',
  modes: ['encrypt', 'decrypt'],
  exec({ mode, text }) {
    return {
      text: mode === 'encrypt' ? base64Encode(text) : base64Decode(text)
    }
  }
})
