import type { OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfig } from '../config/load.js'
import type { ServiceConfigurationManager } from '../configuration/manager.js'
import type { ServiceConfigurationDefinition } from '../configuration/types.js'
import type { AppEnv } from '../types/app.js'
import { registerBingRoutes } from './bing/routes.js'
import { cryptoConfigurationGroup } from './crypto/configuration.js'
import { registerCryptoRoutes } from './crypto/routes.js'
import { registerDaily60sRoutes } from './daily60s/routes.js'
import { registerEpicRoutes } from './epic/routes.js'
import { registerExchangeRateRoutes } from './exchange-rate/routes.js'
import { registerFuelPriceRoutes } from './fuel-price/routes.js'
import { registerGoldPriceRoutes } from './gold-price/routes.js'
import { registerLanzouRoutes } from './lanzou/routes.js'
import { registerLuckRoutes } from './luck/routes.js'
import { registerMinecraftRoutes } from './minecraft/routes.js'
import { ipConfigurationGroup, registerIpModule } from './ip/index.js'
import { musicConfigurationGroup, registerMusicModule } from './music/index.js'
import { registerPlayerRoutes } from './player/routes.js'
import { registerPasswordCheckRoutes } from './password-check/routes.js'
import { registerPasswordGeneratorRoutes } from './password-generator/routes.js'
import { registerQqAvatarRoutes } from './qq-avatar/routes.js'
import { registerShortVideoRoutes } from './short-video/routes.js'
import { registerTodayInHistoryRoutes } from './today-in-history/routes.js'
import { registerYiyanRoutes } from './yiyan/routes.js'

export const serviceConfigurationDefinition = {
  schemaVersion: 1,
  groups: [
    ipConfigurationGroup,
    cryptoConfigurationGroup,
    musicConfigurationGroup
  ]
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
  registerDaily60sRoutes(app)
  registerBingRoutes(app)
  registerCryptoRoutes(app, configuration)
  registerEpicRoutes(app)
  registerExchangeRateRoutes(app)
  registerFuelPriceRoutes(app)
  registerGoldPriceRoutes(app)
  registerLanzouRoutes(app)
  registerLuckRoutes(app)
  registerMinecraftRoutes(app)
  registerMusicModule(app, configuration)
  registerPlayerRoutes(app)
  registerPasswordCheckRoutes(app)
  registerPasswordGeneratorRoutes(app)
  registerQqAvatarRoutes(app)
  registerShortVideoRoutes(app)
  registerTodayInHistoryRoutes(app)
  registerIpModule(app, config, configuration)
}
