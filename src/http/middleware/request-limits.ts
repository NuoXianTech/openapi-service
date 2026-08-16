import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { ServiceError } from '../errors.js'
import { respondWithFailure } from '../../shared/response.js'
import type { AppEnv } from '../../types/app.js'

export function createBodyLimitMiddleware(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: (c) => {
      return respondWithFailure(
        c,
        413,
        'REQUEST_BODY_TOO_LARGE',
        '请求体超过服务限制'
      )
    }
  })
}

export function createDeadlineMiddleware(timeoutMs: number) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const timeoutController = new AbortController()
    const deadlineSignal = AbortSignal.any([
      c.req.raw.signal,
      timeoutController.signal
    ])
    c.set('deadlineSignal', deadlineSignal)

    let timeout: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new ServiceError(
          504,
          'REQUEST_TIMEOUT',
          '请求处理超时'
        )
        timeoutController.abort(error)
        reject(error)
      }, timeoutMs)
      timeout.unref()
    })

    try {
      await Promise.race([next(), timeoutPromise])
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  })
}
