import {
  createAcwScV2Cookie,
  fetchLanzouText,
  postLanzouDownloadForm,
  resolveLanzouDownload,
  type LanzouChallengeState,
  type LanzouTextResponse
} from './client.js'
import {
  classifyLanzouError,
  createPasswordDownloadForm,
  createPublicDownloadForm,
  createQueryDownloadForm,
  isLanzouHost,
  LanzouError,
  lanzouFailure,
  parseLanzouDownloadResponse,
  parseLanzouSharePage,
  parseLanzouShareUrl,
  trustedLanzouUrl,
  type LanzouDownloadForm,
  type LanzouFileData
} from './parser.js'

export {
  classifyLanzouError,
  createAcwScV2Cookie,
  parseLanzouShareUrl
}
export type { LanzouFileData }

async function fetchSharePage(
  source: URL,
  state: LanzouChallengeState,
  signal?: AbortSignal
): Promise<LanzouTextResponse> {
  try {
    return await fetchLanzouText(source, state, undefined, signal)
  } catch (originalError) {
    if (signal?.aborted || source.hostname === 'www.lanzouf.com') {
      throw originalError
    }
    const fallbackUrl = new URL(source)
    fallbackUrl.hostname = 'www.lanzouf.com'
    state.cookie = ''
    try {
      return await fetchLanzouText(fallbackUrl, state, undefined, signal)
    } catch (fallbackError) {
      throw new AggregateError(
        [originalError, fallbackError],
        '蓝奏云原始域名和备用域名均请求失败'
      )
    }
  }
}

function resolveIframe(source: string, base: URL): URL | null {
  if (!source) return null
  try {
    return trustedLanzouUrl(
      new URL(source, base).toString(),
      isLanzouHost
    )
  } catch {
    return null
  }
}

export async function parseLanzouFile(
  source: URL,
  password = '',
  signal?: AbortSignal
): Promise<LanzouFileData> {
  try {
    const state: LanzouChallengeState = { cookie: '' }
    const share = await fetchSharePage(source, state, signal)
    const file = parseLanzouSharePage(share.text)
    let form: LanzouDownloadForm
    let referer = share.url
    let formBase = share.url

    if (file.protectedFile && !source.search) {
      if (!password) {
        throw lanzouFailure(
          'input', 400, 'PASSWORD_REQUIRED',
          '该蓝奏云文件需要提供 pwd 分享密码'
        )
      }
      form = createPasswordDownloadForm(share.text, password)
    } else if (source.search) {
      form = createQueryDownloadForm(share.text)
    } else {
      const iframe = resolveIframe(file.iframeSource, share.url)
      if (!iframe) {
        throw lanzouFailure(
          'business', 422, 'PARSE_FAILED',
          '蓝奏云分享页结构已变化，暂时无法解析'
        )
      }
      const downloadPage = await fetchLanzouText(
        iframe,
        state,
        share.url,
        signal
      )
      form = createPublicDownloadForm(downloadPage.text)
      referer = downloadPage.url
      formBase = downloadPage.url
    }

    const payload = await postLanzouDownloadForm(
      formBase,
      form.path,
      form.body,
      referer,
      state,
      signal
    )
    const result = parseLanzouDownloadResponse(payload, file.protectedFile)
    const finalUrl = await resolveLanzouDownload(
      result.url,
      share.url,
      state,
      signal
    )
    return {
      name: result.name || file.name,
      size: file.size,
      url: finalUrl.toString()
    }
  } catch (error) {
    if (error instanceof LanzouError) throw error
    throw lanzouFailure(
      'upstream', 502, 'UPSTREAM_ERROR',
      '请求蓝奏云服务失败', { cause: error }
    )
  }
}
