import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

const DICTIONARY = ['嗷', '呜', '啊', '~']

function beastEncode(text: string): string {
  let hexadecimal = ''
  for (let index = 0; index < text.length; index++) {
    hexadecimal += text.charCodeAt(index).toString(16).padStart(4, '0')
  }
  let output = ''
  for (let index = 0; index < hexadecimal.length; index++) {
    const digit = Number.parseInt(hexadecimal[index]!, 16)
    const value = (digit + (index % 16)) % 16
    output += DICTIONARY[Math.floor(value / 4)]! + DICTIONARY[value % 4]!
  }
  return output
}

function beastDecode(text: string): string {
  const characters = Array.from(text).filter(
    character => DICTIONARY.includes(character)
  )
  if (characters.length === 0) return ''
  if (characters.length % 2 !== 0) {
    throw createCryptoBusinessError('密文长度异常，无法解码（汉字数应为偶数）')
  }
  let hexadecimal = ''
  for (let index = 0; index < characters.length; index += 2) {
    const value = DICTIONARY.indexOf(characters[index]!) * 4
      + DICTIONARY.indexOf(characters[index + 1]!)
    const offset = (index / 2) % 16
    hexadecimal += ((value - offset + 16) % 16).toString(16)
  }
  if (hexadecimal.length % 4 !== 0) {
    throw createCryptoBusinessError('密文长度异常，无法还原为字符')
  }
  let output = ''
  for (let index = 0; index < hexadecimal.length; index += 4) {
    output += String.fromCharCode(
      Number.parseInt(hexadecimal.slice(index, index + 4), 16)
    )
  }
  return output
}

registerCryptoAlgorithm({
  name: 'beast',
  title: '兽语',
  description: '把任意文本编码为「嗷呜啊~」四字组成的兽语。',
  summary: '把普通文本转换成「嗷呜啊~」组成的兽语，也可以还原。',
  modes: ['encrypt', 'decrypt'],
  exec({ mode, text }) {
    return { text: mode === 'encrypt' ? beastEncode(text) : beastDecode(text) }
  }
})
