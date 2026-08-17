import {
  AES_256_CBC,
  opensslSaltedDecrypt,
  opensslSaltedEncrypt
} from '../cryptojs-openssl.js'
import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'

const PREFIX = '佛又曰：'
const BASE64_PREFIX = 'U2FsdGVkX1'
const DEFAULT_KEY = 'takuron.top'
const PAIRS: Array<[string, string]> = [
  ['e', '啰'], ['E', '羯'], ['t', '婆'], ['T', '提'], ['a', '摩'], ['A', '埵'],
  ['o', '诃'], ['O', '迦'], ['i', '耶'], ['I', '吉'], ['n', '娑'], ['N', '佛'],
  ['s', '夜'], ['S', '驮'], ['h', '那'], ['H', '谨'], ['r', '悉'], ['R', '墀'],
  ['d', '阿'], ['D', '呼'], ['l', '萨'], ['L', '尼'], ['c', '陀'], ['C', '唵'],
  ['u', '唎'], ['U', '伊'], ['m', '卢'], ['M', '喝'], ['w', '帝'], ['W', '烁'],
  ['f', '醯'], ['F', '蒙'], ['g', '罚'], ['G', '沙'], ['y', '嚧'], ['Y', '他'],
  ['p', '南'], ['P', '豆'], ['b', '无'], ['B', '孕'], ['v', '菩'], ['V', '伽'],
  ['k', '怛'], ['K', '俱'], ['j', '哆'], ['J', '度'], ['x', '皤'], ['X', '阇'],
  ['q', '室'], ['Q', '地'], ['z', '利'], ['Z', '遮'], ['0', '穆'], ['1', '参'],
  ['2', '舍'], ['3', '苏'], ['4', '钵'], ['5', '曳'], ['6', '数'], ['7', '写'],
  ['8', '栗'], ['9', '楞'], ['+', '咩'], ['/', '输'], ['=', '漫']
]
const TO_BUDDHA = new Map(PAIRS)
const FROM_BUDDHA = new Map(PAIRS.map(([base64, buddha]) => [buddha, base64]))

function buddhaEncrypt(message: string, key = DEFAULT_KEY): string {
  if (!message) throw createCryptoBusinessError('待加密明文不能为空')
  const ciphertext = opensslSaltedEncrypt(
    message,
    key || DEFAULT_KEY,
    AES_256_CBC
  )
  if (!ciphertext.startsWith(BASE64_PREFIX)) {
    throw createCryptoBusinessError('内部加密格式异常')
  }
  return PREFIX + Array.from(ciphertext.slice(BASE64_PREFIX.length))
    .map((character) => {
      const mapped = TO_BUDDHA.get(character)
      if (!mapped) {
        throw createCryptoBusinessError(`内部编码错误：未知字符 ${character}`)
      }
      return mapped
    }).join('')
}

function buddhaDecrypt(ciphertext: string, key = DEFAULT_KEY): string {
  if (!ciphertext) throw createCryptoBusinessError('待解密密文不能为空')
  if (!ciphertext.startsWith(PREFIX)) {
    throw createCryptoBusinessError(`密文必须以 "${PREFIX}" 开头`)
  }
  const base64 = BASE64_PREFIX + Array.from(ciphertext.slice(PREFIX.length))
    .map((character) => {
      const mapped = FROM_BUDDHA.get(character)
      if (!mapped) throw createCryptoBusinessError('密文包含非佛语字符，无法还原')
      return mapped
    }).join('')
  try {
    return opensslSaltedDecrypt(base64, key || DEFAULT_KEY, AES_256_CBC)
  } catch {
    throw createCryptoBusinessError('解密失败：密文或密钥错误')
  }
}

registerCryptoAlgorithm({
  name: 'buddha',
  title: '与佛论禅',
  description: 'AES 加密后映射为佛经字符。',
  summary: '把普通文本转换成佛语字符，也可以还原。',
  modes: ['encrypt', 'decrypt'],
  options: [{
    name: 'key',
    type: 'string',
    default: DEFAULT_KEY,
    description: 'AES 密钥，留空使用兼容默认值'
  }],
  exec({ mode, text, options }) {
    const key = String(options.key ?? DEFAULT_KEY)
    return {
      text: mode === 'encrypt'
        ? buddhaEncrypt(text, key)
        : buddhaDecrypt(text, key)
    }
  }
})
