import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

const PACKED: Record<string, string> = {
  A: 'DH', B: 'HDDD', C: 'HDHD', D: 'HDD', E: 'D', F: 'DDHD',
  G: 'HHD', H: 'DDDD', I: 'DD', J: 'DHHH', K: 'HDH', L: 'DHDD',
  M: 'HH', N: 'HD', O: 'HHH', P: 'DHHD', Q: 'HHDH', R: 'DHD',
  S: 'DDD', T: 'H', U: 'DDH', V: 'DDDH', W: 'DHH', X: 'HDDH',
  Y: 'HDHH', Z: 'HHDD',
  0: 'HHHHH', 1: 'DHHHH', 2: 'DDHHH', 3: 'DDDHH', 4: 'DDDDH',
  5: 'DDDDD', 6: 'HDDDD', 7: 'HHDDD', 8: 'HHHDD', 9: 'HHHHD',
  '.': 'DHDHDH', ',': 'HHDDHH', '?': 'DDHHDD', "'": 'DHHHHD',
  '!': 'HDHDHH', '/': 'HDDHD', '(': 'HDHHD', ')': 'HDHHDH',
  '&': 'DHDDD', ':': 'HHHDDD', ';': 'HDHDHD', '=': 'HDDDH',
  '+': 'DHDHD', '-': 'HDDDDH', _: 'DDHHDH', '"': 'DHDDHD',
  '@': 'DHHDHD'
}
const TO_MORSE = Object.fromEntries(
  Object.entries(PACKED).map(([character, packed]) => [
    character,
    packed.replaceAll('D', '.').replaceAll('H', '-')
  ])
) as Record<string, string>
const FROM_MORSE = Object.fromEntries(
  Object.entries(TO_MORSE).map(([character, morse]) => [morse, character])
) as Record<string, string>

function morseEncode(text: string): string {
  return text.toUpperCase().split(/\s+/).filter(Boolean).map((word) => (
    Array.from(word).map((character) => {
      const code = TO_MORSE[character]
      if (!code) {
        throw createCryptoBusinessError(
          `字符 "${character}" 不在摩斯码表中（仅支持 A-Z / 0-9 / 常用标点）`
        )
      }
      return code
    }).join(' ')
  )).join(' / ')
}

function morseDecode(text: string): string {
  if (!text.trim()) return ''
  return text.trim().split(/\s*\/\s*/).map((word) => (
    word.trim().split(/\s+/).filter(Boolean).map((code) => {
      const character = FROM_MORSE[code]
      if (!character) {
        throw createCryptoBusinessError(`未识别的摩斯片段 "${code}"`)
      }
      return character
    }).join('')
  )).join(' ')
}

registerCryptoAlgorithm({
  name: 'morse',
  title: '摩斯密码',
  description: 'ITU 国际摩斯码表，覆盖字母、数字和常用标点。',
  summary: '在字母、数字和摩斯密码之间转换。',
  modes: ['encrypt', 'decrypt'],
  exec({ mode, text }) {
    return { text: mode === 'encrypt' ? morseEncode(text) : morseDecode(text) }
  }
})
