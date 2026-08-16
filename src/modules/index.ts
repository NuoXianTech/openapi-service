import type { OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfig } from '../config/load.js'
import type { ServiceConfigurationManager } from '../configuration/manager.js'
import type { ServiceConfigurationDefinition } from '../configuration/types.js'
import type { AppEnv } from '../types/app.js'
import { ipConfigurationGroup } from './ip/configuration.js'
import { registerIpRoutes } from './ip/routes.js'
import { clearIpDatabaseCache } from './ip/service.js'
import { registerPlayerRoutes } from './player/routes.js'
import { registerYiyanRoutes } from './yiyan/routes.js'

export const serviceConfigurationDefinition = {
  schemaVersion: 1,
  groups: [ipConfigurationGroup]
} as const satisfies ServiceConfigurationDefinition

/**
 * Static composition root for business modules.
 *
 * Adding a module requires one explicit import and one registration call.
 * There is intentionally no runtime directory scan, plugin loader, or
 * dependency-injection container.
 */
export function registerServiceModules(
  app: OpenAPIHono<AppEnv>,
  config: ServiceConfig,
  configuration: ServiceConfigurationManager
) {
  registerYiyanRoutes(app)
  registerPlayerRoutes(app)
  configuration.subscribe((current, previous) => {
    if (
      current.values['ip.databaseKey']
      !== previous.values['ip.databaseKey']
    ) {
      clearIpDatabaseCache()
    }
  })
  registerIpRoutes(app, {
    directory: config.ipDatabaseDirectory,
    configuration
  })
}
