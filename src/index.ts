import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createPersistentConfigurationManager } from './configuration/create.js'
import { createJsonLogger } from './shared/logger.js'
import { serviceConfigurationDefinition } from './modules/index.js'
import { RuntimeState } from './runtime-state.js'

const logger = createJsonLogger()

async function main() {
  try {
    const config = loadConfig()
    const runtimeState = new RuntimeState(false, 'starting')
    const configuration = createPersistentConfigurationManager(
      config,
      serviceConfigurationDefinition
    )
    await configuration.initialize()
    const app = createApp({
      config,
      logger,
      runtimeState,
      configuration
    })
    let shuttingDown = false
    const server = serve(
      {
        fetch: app.fetch,
        hostname: config.hostname,
        port: config.port
      },
      (info) => {
        runtimeState.markReady()
        logger.info('openapi-service listening', {
          hostname: config.hostname,
          port: info.port,
          version: config.version,
          commit: config.commit
        })
      }
    ) as Server

    server.headersTimeout = config.readHeaderTimeoutMs
    server.requestTimeout = config.requestTimeoutMs + 1_000

    server.on('error', (error) => {
      runtimeState.markNotReady('server_error')
      logger.error('node server error', {
        error_name: error.name
      })
      if (!shuttingDown) {
        process.exitCode = 1
      }
    })

    const shutdown = (signal: string) => {
      if (shuttingDown) {
        return
      }
      shuttingDown = true
      runtimeState.markNotReady('shutting_down')
      logger.info('openapi-service shutting down', { signal })

      const forceTimer = setTimeout(() => {
        logger.error('graceful shutdown timed out')
        server.closeAllConnections()
        process.exit(1)
      }, config.shutdownTimeoutMs)
      forceTimer.unref()

      server.close((error) => {
        clearTimeout(forceTimer)
        if (error) {
          logger.error('openapi-service shutdown failed', {
            error: error.message
          })
          process.exit(1)
        }
        logger.info('openapi-service stopped')
        process.exit(0)
      })
    }

    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    logger.error('openapi-service failed to start', {
      error: error instanceof Error ? error.message : 'unknown startup error'
    })
    process.exitCode = 1
  }
}

void main()
