import { fileURLToPath } from 'node:url'

export const packageDirectory = fileURLToPath(
  new URL('../..', import.meta.url)
)
