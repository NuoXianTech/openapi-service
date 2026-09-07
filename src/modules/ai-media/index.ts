import { detectAiMediaPlatform, parseAiMediaUrl } from './input.js'
import { parseDoubao } from './platforms/doubao.js'
import { parseHailuo } from './platforms/hailuo.js'
import { parseJimeng } from './platforms/jimeng.js'
import { parseKling } from './platforms/kling.js'
import { parseQianwen } from './platforms/qianwen.js'
import { parseXiaoyunque } from './platforms/xiaoyunque.js'
import type { AiMediaData, AiMediaPlatform, AiMediaRequestOptions } from './types.js'

const parsers: Record<AiMediaPlatform, (source: URL, options: AiMediaRequestOptions) => Promise<AiMediaData>> = {
  doubao: parseDoubao, jimeng: parseJimeng, xiaoyunque: parseXiaoyunque,
  kling: parseKling, hailuo: parseHailuo, qianwen: parseQianwen
}

export async function parseAiMedia(input: string, options: AiMediaRequestOptions = {}): Promise<AiMediaData> {
  const source = parseAiMediaUrl(input)
  const platform = detectAiMediaPlatform(source)
  const signal = options.signal ?? AbortSignal.timeout(20_000)
  signal.throwIfAborted()
  const data = await parsers[platform](source, { ...options, signal })
  signal.throwIfAborted()
  return data
}
