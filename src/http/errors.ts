import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AppEnv } from '../types/app.js'
import { respondWithFailure } from '../shared/response.js'

export type ErrorDetails = Record<
  string,
  string | number | boolean | null
>

export class ServiceError extends Error {
  readonly code: string
  readonly status: ContentfulStatusCode
  readonly details?: ErrorDetails

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: ErrorDetails
  ) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
    this.code = code
    if (details) {
      this.details = details
    }
  }
}

export function normalizeServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error
  }

  return new ServiceError(
    500,
    'INTERNAL_ERROR',
    '服务内部错误'
  )
}

export function respondWithError(
  c: Context<AppEnv>,
  error: ServiceError
) {
  return respondWithFailure(
    c,
    error.status,
    error.code,
    error.message,
    error.details ?? null
  )
}
