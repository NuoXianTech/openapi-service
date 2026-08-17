import {
  createCryptoBusinessError,
  isCryptoBusinessError
} from './types.js'
import { rc4Process } from './cryptojs-openssl.js'

export type BytesEncoding = 'hex' | 'base64' | 'utf8'
export type CipherEncoding = 'hex' | 'base64'

function decodeBytes(
  value: string,
  encoding: BytesEncoding,
  field: string
): Buffer {
  const cleaned = value.replace(/\s+/g, '')
  if (encoding === 'hex') {
    if (!/^[0-9a-f]*$/i.test(cleaned) || cleaned.length % 2 !== 0) {
      throw createCryptoBusinessError(`参数 ${field} 不是合法的 hex 字符串`)
    }
    return Buffer.from(cleaned, 'hex')
  }
  if (encoding === 'base64') {
    const buffer = Buffer.from(cleaned, 'base64')
    if (
      buffer.toString('base64').replace(/=+$/, '')
      !== cleaned.replace(/=+$/, '')
    ) {
      throw createCryptoBusinessError(`参数 ${field} 不是合法的 base64 字符串`)
    }
    return buffer
  }
  return Buffer.from(value, 'utf8')
}

function encodeBytes(buffer: Buffer, encoding: CipherEncoding): string {
  return buffer.toString(encoding)
}

export function rc4RawEncrypt(
  plaintext: string,
  key: string,
  keyEncoding: BytesEncoding,
  cipherEncoding: CipherEncoding
): string {
  if (!plaintext) throw createCryptoBusinessError('待加密明文不能为空')
  const keyBuffer = decodeBytes(key, keyEncoding, 'key')
  if (keyBuffer.length === 0) {
    throw createCryptoBusinessError('RC4 密钥长度不能为 0')
  }
  return encodeBytes(
    rc4Process(keyBuffer, Buffer.from(plaintext, 'utf8')),
    cipherEncoding
  )
}

export function rc4RawDecrypt(
  ciphertext: string,
  key: string,
  keyEncoding: BytesEncoding,
  cipherEncoding: CipherEncoding
): string {
  if (!ciphertext) throw createCryptoBusinessError('待解密密文不能为空')
  const keyBuffer = decodeBytes(key, keyEncoding, 'key')
  if (keyBuffer.length === 0) {
    throw createCryptoBusinessError('RC4 密钥长度不能为 0')
  }
  try {
    return rc4Process(
      keyBuffer,
      decodeBytes(ciphertext, cipherEncoding, 'text')
    ).toString('utf8')
  } catch (error) {
    if (isCryptoBusinessError(error)) throw error
    throw createCryptoBusinessError('解密失败：密文或密钥错误')
  }
}
