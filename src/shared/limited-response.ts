export async function readLimitedBuffer(
  response: Response,
  maximumBytes: number,
  limitMessage = 'upstream response is too large'
): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(limitMessage)
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maximumBytes) {
        throw new Error(limitMessage)
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function readLimitedText(
  response: Response,
  maximumBytes: number,
  limitMessage = 'upstream response is too large'
): Promise<string> {
  const buffer = await readLimitedBuffer(response, maximumBytes, limitMessage)
  return new TextDecoder().decode(buffer)
}
