import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { CzdbSearcher, type CzdbIpVersion } from './czdb.js'

export interface IpLocationData {
  ip: string
  ip_version: 'ipv4' | 'ipv6'
  country_name: string | null
  region_name: string | null
  city_name: string | null
  district_name: string | null
  internet_service_provider: string | null
  database_version: number
}

export type IpLookupErrorCode = 'IP_DATABASE_NOT_CONFIGURED' | 'IP_DATABASE_UNAVAILABLE'

export class IpLookupError extends Error {
  constructor(
    readonly code: IpLookupErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'IpLookupError'
  }
}

interface SearcherCacheEntry {
  path: string
  key: string
  promise: Promise<CzdbSearcher>
}

const databaseFilenames: Record<CzdbIpVersion, string> = {
  4: 'cz88_public_v4.czdb',
  6: 'cz88_public_v6.czdb'
}
const searcherCache = new Map<CzdbIpVersion, SearcherCacheEntry>()

function nullablePart(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized && normalized.toLowerCase() !== 'null' ? normalized : null
}

export function parseCzdbRegion(raw: string) {
  const columns = raw.split('\t').map((value) => value.trim())
  const first = columns[0] ?? ''
  if (!first && columns.every((value) => !value)) return null
  const locationParts = first.split(/[–—]/u).map((value) => value.trim())
  const geoParts = locationParts.length > 1
    ? locationParts
    : columns.length > 2 ? columns.slice(0, -1) : [first]
  const ispParts = locationParts.length > 1
    ? columns.slice(1)
    : columns.length > 2 ? columns.slice(-1) : columns.slice(1)
  return {
    countryName: nullablePart(geoParts[0]),
    regionName: nullablePart(geoParts[1]),
    cityName: nullablePart(geoParts[2]),
    districtName: nullablePart(geoParts.slice(3).map(nullablePart).filter(Boolean).join('–')),
    internetServiceProvider: nullablePart(ispParts.map(nullablePart).filter(Boolean).join(' '))
  }
}

async function getSearcher(
  version: CzdbIpVersion,
  directory: string,
  keyValue: string
): Promise<CzdbSearcher> {
  const key = keyValue.trim()
  if (!key) throw new IpLookupError('IP_DATABASE_NOT_CONFIGURED', 'CZDB key is required')
  const path = resolve(directory, databaseFilenames[version])
  const cached = searcherCache.get(version)
  if (cached?.path === path && cached.key === key) return await cached.promise
  const promise = CzdbSearcher.open(path, version, key)
  const entry = { path, key, promise }
  searcherCache.set(version, entry)
  promise.catch(() => {
    if (searcherCache.get(version) === entry) searcherCache.delete(version)
  })
  return await promise
}

export function clearIpDatabaseCache(): void {
  searcherCache.clear()
}

export async function lookupIpLocation(
  ip: string,
  key: string,
  directory = resolve(process.cwd(), 'data', 'ip')
): Promise<IpLocationData | null> {
  const version = isIP(ip)
  if (version !== 4 && version !== 6) throw new TypeError('Invalid IP address')
  let searcher: CzdbSearcher
  try {
    searcher = await getSearcher(version, directory, key)
  } catch (error) {
    if (error instanceof IpLookupError) throw error
    throw new IpLookupError(
      'IP_DATABASE_UNAVAILABLE',
      `IPv${version} CZDB database is unavailable`,
      { cause: error }
    )
  }
  try {
    const result = await searcher.search(ip)
    if (!result) return null
    const region = parseCzdbRegion(result.raw)
    if (!region) return null
    return {
      ip,
      ip_version: version === 4 ? 'ipv4' : 'ipv6',
      country_name: region.countryName,
      region_name: region.regionName,
      city_name: region.cityName,
      district_name: region.districtName,
      internet_service_provider: region.internetServiceProvider,
      database_version: result.databaseVersion
    }
  } catch (error) {
    if (error instanceof IpLookupError) throw error
    throw new IpLookupError(
      'IP_DATABASE_UNAVAILABLE',
      `IPv${version} CZDB lookup failed`,
      { cause: error }
    )
  }
}
