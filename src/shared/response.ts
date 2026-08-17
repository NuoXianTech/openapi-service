import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../types/app.js'

export interface ApiResponse<T> {
  code: 'OK'
  message: string
  data: T | null
  timestamp: number
}

export function createSuccessResponse<T>(
  data: T,
  message = '请求成功'
): ApiResponse<T> {
  return {
    code: 'OK',
    message,
    data,
    timestamp: Date.now()
  }
}

export function respondWithSuccess<T>(
  c: Context<AppEnv>,
  data: T,
  message = '请求成功',
  cacheControl = 'no-store'
) {
  c.header('cache-control', cacheControl)
  return c.json(createSuccessResponse(data, message), 200)
}

export function respondWithFailure<
  TStatus extends ContentfulStatusCode,
  TData = never
>(
  c: Context<AppEnv>,
  status: TStatus,
  code: string,
  message: string,
  data: TData | null = null
) {
  c.header('cache-control', 'no-store')
  c.header('x-openapi-error-code', code)
  return c.json(
    {
      code,
      message,
      data,
      timestamp: Date.now()
    },
    status
  )
}
