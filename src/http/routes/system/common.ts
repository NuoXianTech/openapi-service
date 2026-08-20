import { ErrorResponseSchema } from '../../../contracts/service.js'

export function errorResponse(description: string) {
  return {
    content: {
      'application/json': {
        schema: ErrorResponseSchema
      }
    },
    description
  } as const
}

export const unauthorizedResponse = errorResponse(
  'Service Token is missing or invalid'
)

export function matchesETag(header: string | undefined, etag: string): boolean {
  return header?.split(',').some(value => value.trim() === etag) === true
}
