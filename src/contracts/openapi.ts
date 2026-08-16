import { canonicalize, canonicalSha256 } from '../shared/canonical-json.js'

export interface OpenAPIContract {
  document: Record<string, unknown>
  sha256: string
  etag: string
}

export function createOpenAPIContract(
  document: Record<string, unknown>
): OpenAPIContract {
  const canonicalDocument = canonicalize(document) as Record<
    string,
    unknown
  >
  const sha256 = canonicalSha256(canonicalDocument)

  return {
    document: canonicalDocument,
    sha256,
    etag: `"sha256-${sha256}"`
  }
}
