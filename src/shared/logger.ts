type LogFields = Record<
  string,
  string | number | boolean | null | undefined
>

export interface Logger {
  info(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

export function createJsonLogger(): Logger {
  return {
    info(message, fields) {
      writeLog(process.stdout, 'info', message, fields)
    },
    error(message, fields) {
      writeLog(process.stderr, 'error', message, fields)
    }
  }
}

function writeLog(
  stream: NodeJS.WriteStream,
  level: 'info' | 'error',
  message: string,
  fields: LogFields = {}
) {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter((entry) => entry[1] !== undefined)
  )
  stream.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...safeFields
    }) + '\n'
  )
}
