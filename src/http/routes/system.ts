import type { OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfig } from '../../config.js'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { RuntimeState } from '../../runtime-state.js'
import type { AppEnv } from '../types.js'
import { registerSystemConfigurationRoutes } from './system/configuration.js'
import { registerSystemDiscoveryRoutes } from './system/discovery.js'
import { registerSystemHealthRoutes } from './system/health.js'

export function registerSystemRoutes(
  app: OpenAPIHono<AppEnv>,
  config: ServiceConfig,
  runtimeState: RuntimeState,
  configuration: ServiceConfigurationManager
): void {
  app.openAPIRegistry.registerComponent(
    'securitySchemes',
    'serviceToken',
    {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Authorization: Service <token>'
    }
  )

  registerSystemHealthRoutes(app, runtimeState)
  registerSystemDiscoveryRoutes(app, config, configuration)
  registerSystemConfigurationRoutes(app, configuration)
}
