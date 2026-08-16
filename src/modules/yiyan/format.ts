import iconv from 'iconv-lite'
import type {
  YiyanCharset,
  YiyanEncode,
  YiyanRecord,
  YiyanSentence,
  YiyanType
} from './types.js'

export function toRecord(
  sentence: YiyanSentence,
  type: YiyanType
): YiyanRecord {
  return {
    id: `${type}${sentence.id}`,
    yiyan: sentence.yiyan,
    type: sentence.type || type,
    from: sentence.from ?? null,
    from_who: sentence.from_who ?? null,
    created_at: sentence.created_at,
    length: typeof sentence.length === 'number'
      ? sentence.length
      : [...sentence.yiyan].length
  }
}

export function formatYiyanText(record: YiyanRecord): string {
  return record.yiyan
}

export function formatYiyanJavaScript(
  record: YiyanRecord,
  selector: string
): string {
  return `(function(){var t=${JSON.stringify(record.yiyan)};var els=document.querySelectorAll(${JSON.stringify(selector)});`
    + 'for(var i=0;i<els.length;i++){els[i].innerText=t}})()'
}

export function formatYiyanMarkdown(record: YiyanRecord): string {
  const lines = [`> ${record.yiyan}`]
  const attribution = record.from_who && record.from
    ? `${record.from_who}「${record.from}」`
    : record.from
      ? `「${record.from}」`
      : record.from_who ?? ''
  if (attribution) lines.push('>', `> —— ${attribution}`)
  return lines.join('\n')
}

export function isValidJsonpCallback(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

export function encodeYiyanBody(
  text: string,
  charset: YiyanCharset
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    charset === 'gbk'
      ? iconv.encode(text, 'gbk')
      : Buffer.from(text, 'utf8')
  )
}

export function yiyanContentType(
  encode: YiyanEncode | 'jsonp',
  charset: YiyanCharset
): string {
  const normalizedCharset = charset === 'gbk' ? 'gbk' : 'utf-8'
  if (encode === 'text') return `text/plain; charset=${normalizedCharset}`
  if (encode === 'md') return `text/markdown; charset=${normalizedCharset}`
  if (encode === 'js' || encode === 'jsonp') {
    return `application/javascript; charset=${normalizedCharset}`
  }
  return `application/json; charset=${normalizedCharset}`
}
