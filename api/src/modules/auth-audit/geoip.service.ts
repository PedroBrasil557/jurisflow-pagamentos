import { eq } from 'drizzle-orm'
import { env } from '../../shared/config/env'
import { db } from '../../shared/db'
import { ipGeoCache } from './auth-audit.schema'

export type GeoLocation = {
  city: string | null
  region: string | null
  country: string | null
}

const EMPTY_GEO: GeoLocation = { city: null, region: null, country: null }

// IPs privados/locais nunca resolvem para uma localidade publica.
function isPrivateOrLocalIp(ip: string) {
  const value = ip.trim().toLowerCase()

  if (
    value === '' ||
    value === '127.0.0.1' ||
    value === '::1' ||
    value === 'localhost' ||
    value.startsWith('127.') ||
    value.startsWith('10.') ||
    value.startsWith('192.168.') ||
    value.startsWith('169.254.') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80')
  ) {
    return true
  }

  // 172.16.0.0 - 172.31.255.255
  if (value.startsWith('172.')) {
    const second = Number(value.split('.')[1])
    if (Number.isInteger(second) && second >= 16 && second <= 31) {
      return true
    }
  }

  return false
}

async function fetchGeoFromApi(ip: string): Promise<GeoLocation> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(`${env.geoip.apiUrl}/${ip}`, {
      signal: controller.signal,
    })

    if (!response.ok) {
      return EMPTY_GEO
    }

    // Formato ip-api.com: { status, city, regionName, country }
    const data = (await response.json()) as {
      status?: string
      city?: string
      regionName?: string
      country?: string
    }

    if (data.status && data.status !== 'success') {
      return EMPTY_GEO
    }

    return {
      city: data.city ?? null,
      region: data.regionName ?? null,
      country: data.country ?? null,
    }
  } catch {
    return EMPTY_GEO
  } finally {
    clearTimeout(timeout)
  }
}

// Resolve a localidade de um IP usando cache em banco; so chama a API externa
// para IPs publicos ainda nao vistos. Nunca lanca erro.
export async function resolveGeo(
  ip: string | null | undefined,
): Promise<GeoLocation> {
  if (!ip || !env.geoip.enabled || isPrivateOrLocalIp(ip)) {
    return EMPTY_GEO
  }

  try {
    const [cached] = await db
      .select()
      .from(ipGeoCache)
      .where(eq(ipGeoCache.ip, ip))
      .limit(1)

    if (cached) {
      return {
        city: cached.city,
        region: cached.region,
        country: cached.country,
      }
    }

    const geo = await fetchGeoFromApi(ip)

    await db
      .insert(ipGeoCache)
      .values({ ip, ...geo })
      .onConflictDoNothing()

    return geo
  } catch {
    return EMPTY_GEO
  }
}
