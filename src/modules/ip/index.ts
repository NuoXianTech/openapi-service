import type { OpenAPIHono } from '@hono/zod-openapi'
import { join } from 'node:path'
import type { ServiceConfig } from '../../config.js'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { AppEnv } from '../../http/types.js'
import { ipConfigurationGroup } from './configuration.js'
import { registerIpRoutes } from './routes.js'
import { clearIpDatabaseCache } from './service.js'

export { ipConfigurationGroup }

export function registerIpModule(
  app: OpenAPIHono<AppEnv>,
  config: ServiceConfig,
  configuration: ServiceConfigurationManager
): void {
  configuration.subscribe((current, previous) => {
    if (
      current.values['ip.databaseKey']
      !== previous.values['ip.databaseKey']
    ) clearIpDatabaseCache()
  })
  registerIpRoutes(app, {
    directory: join(config.assetsDirectory, 'ip'),
    configuration
  })
}
