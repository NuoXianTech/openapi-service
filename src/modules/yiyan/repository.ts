import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { YiyanSentence, YiyanType } from './types.js'

interface PickOptions {
  type: YiyanType
  minLength: number
  maxLength: number
  id?: string | null
}

const dataDirectory = resolve(process.cwd(), 'assets', 'yiyan')
const cache = new Map<YiyanType, Promise<YiyanSentence[]>>()

async function loadSentences(type: YiyanType): Promise<YiyanSentence[]> {
  let pending = cache.get(type)
  if (!pending) {
    pending = readFile(resolve(dataDirectory, `${type}.json`), 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .then((value) => Array.isArray(value) ? value as YiyanSentence[] : [])
    cache.set(type, pending)
    pending.catch(() => cache.delete(type))
  }
  return await pending
}

function parseNumericID(rawID: string): number | null {
  let value = rawID.trim()
  if (value.length > 1 && /^[a-z]/i.test(value)) value = value.slice(1)
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function pickSentence(
  options: PickOptions
): Promise<YiyanSentence | null> {
  const sentences = await loadSentences(options.type)
  if (options.id) {
    const id = parseNumericID(options.id)
    return id === null
      ? null
      : sentences.find((sentence) => sentence.id === id) ?? null
  }

  const matching = sentences.filter((sentence) => (
    sentence.length >= options.minLength
    && sentence.length <= options.maxLength
  ))
  const pool = matching.length > 0 ? matching : sentences
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}
