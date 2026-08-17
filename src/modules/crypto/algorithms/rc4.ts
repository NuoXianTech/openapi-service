import { registerCryptoAlgorithm } from '../registry.js'
import { createCryptoBusinessError } from '../types.js'
import { opensslSaltedDecrypt, opensslSaltedEncrypt, RC4 } from '../cryptojs-openssl.js'
import {
  type BytesEncoding,
  type CipherEncoding,
  rc4RawDecrypt,
  rc4RawEncrypt
} from '../raw-cipher.js'

function rc4Encrypt(plaintext: string, password: string): string {
  if (!plaintext) throw createCryptoBusinessError('待加密明文不能为空')
  if (!password) throw createCryptoBusinessError('密钥不能为空')
  return opensslSaltedEncrypt(plaintext, password, RC4)
}

function rc4Decrypt(ciphertext: string, password: string): string {
  if (!ciphertext) throw createCryptoBusinessError('待解密密文不能为空')
  if (!password) throw createCryptoBusinessError('密钥不能为空')
  try {
    return opensslSaltedDecrypt(ciphertext.trim(), password, RC4)
  } catch {
    throw createCryptoBusinessError('解密失败：密文或密钥错误')
  }
}

registerCryptoAlgorithm({
  name: 'rc4',
  title: 'RC4',
  description: '支持 CryptoJS Salted__ 与 raw 两种 RC4 密文格式。',
  summary: '使用密钥加密文本，或解密已有的 RC4 密文。',
  requiresKey: true,
  modes: ['encrypt', 'decrypt'],
  options: [
    { name: 'key', type: 'string', required: true, description: 'RC4 密钥' },
    {
      name: 'format',
      type: 'string',
      default: 'cryptojs',
      enum: ['cryptojs', 'raw'],
      description: 'CryptoJS 兼容格式或纯密文格式'
    },
    {
      name: 'keyEncoding',
      type: 'string',
      default: 'utf8',
      enum: ['hex', 'base64', 'utf8'],
      description: 'raw 模式的密钥编码'
    },
    {
      name: 'cipherEncoding',
      type: 'string',
      default: 'hex',
      enum: ['hex', 'base64'],
      description: 'raw 模式的密文编码'
    }
  ],
  exec({ mode, text, options }) {
    const key = String(options.key ?? '')
    const format = options.format ?? 'cryptojs'
    if (format === 'cryptojs') {
      return {
        text: mode === 'encrypt'
          ? rc4Encrypt(text, key)
          : rc4Decrypt(text, key)
      }
    }
    const keyEncoding = (options.keyEncoding ?? 'utf8') as BytesEncoding
    const cipherEncoding = (options.cipherEncoding ?? 'hex') as CipherEncoding
    return {
      text: mode === 'encrypt'
        ? rc4RawEncrypt(text, key, keyEncoding, cipherEncoding)
        : rc4RawDecrypt(text, key, keyEncoding, cipherEncoding)
    }
  }
})
