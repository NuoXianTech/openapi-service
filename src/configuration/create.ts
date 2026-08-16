import type { ServiceConfig } from '../config/load.js'
import { EncryptedConfigurationFileStore } from './file-store.js'
import { ServiceConfigurationManager } from './manager.js'
import type { ServiceConfigurationDefinition } from './types.js'

export function createInMemoryConfigurationManager(
  config: ServiceConfig,
  definition: ServiceConfigurationDefinition
) {
  return new ServiceConfigurationManager({
    serviceId: config.serviceId,
    definition
  })
}

export function createPersistentConfigurationManager(
  config: ServiceConfig,
  definition: ServiceConfigurationDefinition
) {
  return new ServiceConfigurationManager({
    serviceId: config.serviceId,
    definition,
    store: new EncryptedConfigurationFileStore({
      filePath: config.configurationFile,
      serviceId: config.serviceId,
      currentToken: config.serviceToken,
      ...(config.previousToken
        ? { previousToken: config.previousToken }
        : {})
    })
  })
}
