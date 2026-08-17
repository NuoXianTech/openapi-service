import './algorithms/base64.js'
import './algorithms/beast.js'
import './algorithms/buddha.js'
import './algorithms/caesar.js'
import './algorithms/core-values.js'
import './algorithms/emoji-aes.js'
import './algorithms/morse.js'
import './algorithms/rc4.js'
import './algorithms/taiji.js'

import { listCryptoAlgorithms } from './registry.js'

export function ensureCryptoAlgorithmsRegistered(): number {
  return listCryptoAlgorithms().length
}
