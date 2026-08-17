import type { OpenAPIHono } from '@hono/zod-openapi'
import { join } from 'node:path'
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
import {
  bindMusicConfiguration,
  musicConfigurationGroup
} from './music/configuration.js'
import { registerMusicRoutes } from './music/routes.js'
import { clearMusicSearchCache } from './music/client.js'
import { ipConfigurationGroup } from './ip/configuration.js'
import { registerIpRoutes } from './ip/routes.js'
import { clearIpDatabaseCache } from './ip/service.js'
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
  bindMusicConfiguration(configuration)
  registerMusicRoutes(app)
  registerPlayerRoutes(app)
  registerPasswordCheckRoutes(app)
  registerPasswordGeneratorRoutes(app)
  registerQqAvatarRoutes(app)
  registerShortVideoRoutes(app)
  registerTodayInHistoryRoutes(app)
  configuration.subscribe((current, previous) => {
    if (
      JSON.stringify(current.values['music.enabledPlatforms'])
        !== JSON.stringify(previous.values['music.enabledPlatforms'])
      || current.values['music.neteaseCookie']
        !== previous.values['music.neteaseCookie']
      || current.values['music.tencentCookie']
        !== previous.values['music.tencentCookie']
      || current.values['music.kugouCookie']
        !== previous.values['music.kugouCookie']
      || current.values['music.baiduCookie']
        !== previous.values['music.baiduCookie']
      || current.values['music.kuwoCookie']
        !== previous.values['music.kuwoCookie']
    ) {
      clearMusicSearchCache()
    }
    if (
      current.values['ip.databaseKey']
      !== previous.values['ip.databaseKey']
    ) {
      clearIpDatabaseCache()
    }
  })
  registerIpRoutes(app, {
    directory: join(config.assetsDirectory, 'ip'),
    configuration
  })
}
