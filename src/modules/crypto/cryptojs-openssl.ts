import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto'

const SALT_MAGIC = Buffer.from('Salted__', 'utf8')

export interface OpenSslCipherSpec {
  keyLength: number
  ivLength: number
  encrypt(plain: Buffer, key: Buffer, iv: Buffer): Buffer
  decrypt(cipher: Buffer, key: Buffer, iv: Buffer): Buffer
}

function deriveKey(
  password: Buffer,
  salt: Buffer,
  keyLength: number,
  ivLength: number
): { key: Buffer, iv: Buffer } {
  const length = keyLength + ivLength
  const blocks: Buffer[] = []
  let previous = Buffer.alloc(0)
  let received = 0
  while (received < length) {
    previous = createHash('md5')
      .update(Buffer.concat([previous, password, salt]))
      .digest()
    blocks.push(previous)
    received += previous.length
  }
  const combined = Buffer.concat(blocks).subarray(0, length)
  return {
    key: combined.subarray(0, keyLength),
    iv: combined.subarray(keyLength)
  }
}

export const AES_256_CBC: OpenSslCipherSpec = {
  keyLength: 32,
  ivLength: 16,
  encrypt(plain, key, iv) {
    const cipher = createCipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([cipher.update(plain), cipher.final()])
  },
  decrypt(encrypted, key, iv) {
    const decipher = createDecipheriv('aes-256-cbc', key, iv)
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  }
}

export function rc4Process(key: Buffer, data: Buffer): Buffer {
  const state = new Uint8Array(256)
  for (let index = 0; index < 256; index++) state[index] = index
  let second = 0
  for (let first = 0; first < 256; first++) {
    second = (second + state[first]! + key[first % key.length]!) & 0xff
    const value = state[first]!
    state[first] = state[second]!
    state[second] = value
  }
  const output = Buffer.allocUnsafe(data.length)
  let first = 0
  second = 0
  for (let index = 0; index < data.length; index++) {
    first = (first + 1) & 0xff
    second = (second + state[first]!) & 0xff
    const value = state[first]!
    state[first] = state[second]!
    state[second] = value
    output[index] = data[index]!
      ^ state[(state[first]! + state[second]!) & 0xff]!
  }
  return output
}

export const RC4: OpenSslCipherSpec = {
  keyLength: 32,
  ivLength: 0,
  encrypt: (plain, key) => rc4Process(key, plain),
  decrypt: (encrypted, key) => rc4Process(key, encrypted)
}

export function opensslSaltedEncrypt(
  plaintext: string,
  password: string,
  specification: OpenSslCipherSpec
): string {
  const salt = randomBytes(8)
  const { key, iv } = deriveKey(
    Buffer.from(password, 'utf8'),
    salt,
    specification.keyLength,
    specification.ivLength
  )
  const encrypted = specification.encrypt(
    Buffer.from(plaintext, 'utf8'),
    key,
    iv
  )
  return Buffer.concat([SALT_MAGIC, salt, encrypted]).toString('base64')
}

export function opensslSaltedDecrypt(
  ciphertext: string,
  password: string,
  specification: OpenSslCipherSpec
): string {
  const raw = Buffer.from(ciphertext, 'base64')
  if (raw.length < 16 || !raw.subarray(0, 8).equals(SALT_MAGIC)) {
    throw new Error('密文缺少 Salted__ 前缀')
  }
  const { key, iv } = deriveKey(
    Buffer.from(password, 'utf8'),
    raw.subarray(8, 16),
    specification.keyLength,
    specification.ivLength
  )
  return specification.decrypt(raw.subarray(16), key, iv).toString('utf8')
}
