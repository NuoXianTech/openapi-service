import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

function applyShift(text: string, shift: number): string {
  const normalized = ((shift % 26) + 26) % 26
  let output = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    const base = code >= 65 && code <= 90
      ? 65
      : code >= 97 && code <= 122 ? 97 : null
    output += base === null
      ? character
      : String.fromCharCode(((code - base + normalized) % 26) + base)
  }
  return output
}

function caesarEncrypt(text: string, shift = 3): string {
  if (!Number.isInteger(shift)) {
    throw createCryptoBusinessError('shift 必须是整数')
  }
  return applyShift(text, shift)
}

function caesarDecrypt(text: string, shift = 3): string {
  if (!Number.isInteger(shift)) {
    throw createCryptoBusinessError('shift 必须是整数')
  }
  return applyShift(text, -shift)
}

registerCryptoAlgorithm({
  name: 'caesar',
  title: '凯撒密码',
  description: '经典字母移位密码，仅对 A-Z / a-z 移位。',
  summary: '按指定距离移动英文字母，也可以反向还原。',
  modes: ['encrypt', 'decrypt'],
  options: [{
    name: 'shift',
    type: 'number',
    default: 3,
    description: '移位距离，必须是整数。'
  }],
  exec({ mode, text, options }) {
    const shift = (options.shift as number | undefined) ?? 3
    return {
      text: mode === 'encrypt'
        ? caesarEncrypt(text, shift)
        : caesarDecrypt(text, shift)
    }
  }
})
