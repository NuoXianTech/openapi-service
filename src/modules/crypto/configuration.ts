import type { ConfigurationGroup } from '../../configuration/types.js'
import { ensureCryptoAlgorithmsRegistered } from './index.js'
import { listCryptoAlgorithms } from './registry.js'

ensureCryptoAlgorithmsRegistered()
const algorithms = listCryptoAlgorithms()

export const cryptoConfigurationGroup = {
  key: 'crypto',
  label: '加密与解密',
  description: '控制 /v1/crypto 对调用方提供的算法。',
  fields: [{
    key: 'crypto.allowedAlgorithms',
    type: 'multi-select',
    label: '可用算法',
    description: '未选中的算法不会出现在列表中，直接调用也会被拒绝。',
    default: algorithms.map(algorithm => algorithm.name),
    options: algorithms.map(algorithm => ({
      value: algorithm.name,
      label: algorithm.title,
      description: algorithm.description
    }))
  }]
} as const satisfies ConfigurationGroup
