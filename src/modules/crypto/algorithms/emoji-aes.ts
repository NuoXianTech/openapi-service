import {
  AES_256_CBC,
  opensslSaltedDecrypt,
  opensslSaltedEncrypt
} from '../cryptojs-openssl.js'
import { registerCryptoAlgorithm } from '../registry.js'
import {
  createCryptoBusinessError,
  isCryptoBusinessError
} from '../types.js'

const EMOJIS = [
  '🍎', '🍌', '🏎', '🚪', '👁', '👣', '😀', '🖐', 'ℹ', '😂',
  '🥋', '✉', '🚹', '🌉', '👌', '🍍', '👑', '👉', '🎤', '🚰',
  '☂', '🐍', '💧', '✖', '☀', '🦓', '🏹', '🎈', '😎', '🎅',
  '🐘', '🌿', '🌏', '🌪', '☃', '🍵', '🍴', '🚨', '📮', '🕹',
  '📂', '🛩', '⌨', '🔄', '🔬', '🐅', '🙃', '🐎', '🌊', '🚫',
  '❓', '⏩', '😁', '😆', '💵', '🤣', '☺', '😊', '😇', '😡',
  '🎃', '😍', '✅', '🔪', '🗒'
]
const BASE64 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/='

function rotateEmojis(rotation: number): string[] {
  return EMOJIS.map((_, index) => EMOJIS[(index + rotation) % EMOJIS.length]!)
}

function emojiAesEncrypt(
  message: string,
  key: string,
  rotation = 0
): string {
  if (!message) throw createCryptoBusinessError('待加密明文不能为空')
  if (!key) throw createCryptoBusinessError('密钥不能为空')
  const emojis = rotateEmojis(rotation)
  return Array.from(
    opensslSaltedEncrypt(message, key, AES_256_CBC)
  ).map((character) => {
    const index = BASE64.indexOf(character)
    if (index < 0) {
      throw createCryptoBusinessError('内部编码错误：Base64 字符越界')
    }
    return emojis[index]!
  }).join('')
}

function emojiAesDecrypt(
  ciphertext: string,
  key: string,
  rotation = 0
): string {
  if (!ciphertext) throw createCryptoBusinessError('待解密密文不能为空')
  if (!key) throw createCryptoBusinessError('密钥不能为空')
  const emojis = rotateEmojis(rotation)
  const base64 = Array.from(ciphertext).map((emoji) => {
    const index = emojis.indexOf(emoji)
    if (index < 0) {
      throw createCryptoBusinessError('密文包含不属于 emoji-aes 字符表的字符')
    }
    return BASE64[index]!
  }).join('')
  try {
    const plaintext = opensslSaltedDecrypt(base64, key, AES_256_CBC)
    if (!plaintext) throw createCryptoBusinessError('解密失败：密文或密钥错误')
    return plaintext
  } catch (error) {
    if (isCryptoBusinessError(error)) throw error
    throw createCryptoBusinessError('解密失败：密文或密钥错误')
  }
}

registerCryptoAlgorithm({
  name: 'emoji-aes',
  title: 'Emoji-AES',
  description: 'AES-256-CBC 加密后将 Base64 替换为 Emoji。',
  summary: '使用密钥把文本转换成 Emoji 密文，也可以还原。',
  requiresKey: true,
  modes: ['encrypt', 'decrypt'],
  options: [
    { name: 'key', type: 'string', required: true, description: 'AES 密钥' },
    {
      name: 'rotation',
      type: 'number',
      default: 0,
      min: 0,
      max: 64,
      description: 'Emoji 表轮转偏移'
    }
  ],
  exec({ mode, text, options }) {
    const key = String(options.key ?? '')
    const rotation = (options.rotation as number | undefined) ?? 0
    return {
      text: mode === 'encrypt'
        ? emojiAesEncrypt(text, key, rotation)
        : emojiAesDecrypt(text, key, rotation)
    }
  }
})
