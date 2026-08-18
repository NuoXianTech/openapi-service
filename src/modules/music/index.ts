import type { OpenAPIHono } from '@hono/zod-openapi'
import type { ServiceConfigurationManager } from '../../configuration/manager.js'
import type { ConfigurationSnapshot } from '../../configuration/types.js'
import type { AppEnv } from '../../http/types.js'
import { createMusicClient } from './client.js'
import { musicConfigurationGroup } from './configuration.js'
import { registerMusicRoutes } from './routes.js'
import { MUSIC_PLATFORMS } from './types.js'

export { musicConfigurationGroup }

function musicConfigurationChanged(
  current: ConfigurationSnapshot,
  previous: ConfigurationSnapshot
): boolean {
  const currentPlatforms = current.values['music.enabledPlatforms'] as string[]
  const previousPlatforms = previous.values['music.enabledPlatforms'] as string[]
  if (
    currentPlatforms.length !== previousPlatforms.length
    || currentPlatforms.some((platform, index) => (
      platform !== previousPlatforms[index]
    ))
  ) return true

  return MUSIC_PLATFORMS.some(platform => (
    current.values[`music.${platform}Cookie`]
    !== previous.values[`music.${platform}Cookie`]
  ))
}

export function registerMusicModule(
  app: OpenAPIHono<AppEnv>,
  configuration: ServiceConfigurationManager
): void {
  const music = createMusicClient(configuration)
  configuration.subscribe((current, previous) => {
    if (musicConfigurationChanged(current, previous)) music.clearSearchCache()
  })
  registerMusicRoutes(app, configuration, music)
}
