import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

const VALUES = '富强民主文明和谐自由平等公正法治爱国敬业诚信友善'

function stringToHex(value: string): string {
  const prepared = value.replace(
    /[A-Za-z0-9\-_.!~*'()]/g,
    character => character.codePointAt(0)!.toString(16)
  )
  return encodeURIComponent(prepared).replaceAll('%', '').toUpperCase()
}

function hexToString(hexadecimal: string): string {
  if (hexadecimal.length % 2 !== 0) {
    throw createCryptoBusinessError('密文长度异常，无法解码')
  }
  let encoded = ''
  for (let index = 0; index < hexadecimal.length; index += 2) {
    encoded += `%${hexadecimal.slice(index, index + 2)}`
  }
  try {
    return decodeURIComponent(encoded)
  } catch {
    throw createCryptoBusinessError('密文内容损坏，无法还原为 UTF-8 文本')
  }
}

function hexToIndexes(hexadecimal: string): number[] {
  const indexes: number[] = []
  for (const character of hexadecimal) {
    const number = Number.parseInt(character, 16)
    if (number < 10) indexes.push(number)
    else if (Math.random() >= 0.5) indexes.push(10, number - 10)
    else indexes.push(11, number - 6)
  }
  return indexes
}

function indexesToHex(indexes: number[]): string {
  const hexadecimal: number[] = []
  for (let index = 0; index < indexes.length; index++) {
    const value = indexes[index]!
    if (value < 10) hexadecimal.push(value)
    else {
      index++
      const following = indexes[index]
      if (following === undefined) {
        throw createCryptoBusinessError('密文长度异常，无法解码')
      }
      hexadecimal.push(following + (value === 10 ? 10 : 6))
    }
  }
  return hexadecimal.map(value => value.toString(16)).join('')
}

function coreValuesEncode(text: string): string {
  return hexToIndexes(stringToHex(text)).map(
    index => VALUES[index * 2]! + VALUES[index * 2 + 1]!
  ).join('')
}

function coreValuesDecode(text: string): string {
  const indexes: number[] = []
  for (const character of text) {
    const index = VALUES.indexOf(character)
    if (index >= 0 && index % 2 === 0) indexes.push(index / 2)
  }
  return hexToString(indexesToHex(indexes))
}

registerCryptoAlgorithm({
  name: 'core-values',
  title: '社会主义核心价值观编码',
  description: '把任意文本编码为核心价值观词组。',
  summary: '把普通文本转换成核心价值观词组，也可以还原。',
  modes: ['encrypt', 'decrypt'],
  exec({ mode, text }) {
    return {
      text: mode === 'encrypt'
        ? coreValuesEncode(text)
        : coreValuesDecode(text)
    }
  }
})
