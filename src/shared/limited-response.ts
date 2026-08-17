export async function readLimitedResponseText(
  response: Response,
  maximumBytes: number,
  limitMessage = 'upstream response is too large'
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(limitMessage)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(limitMessage)
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
    .toString('utf8')
}
