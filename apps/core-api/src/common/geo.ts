// Small geo helpers used until PostGIS is installed (plan Appendix B moves distance queries to SQL).

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch |= 1 << (4 - bit); lngMin = mid; } else lngMax = mid;
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch |= 1 << (4 - bit); latMin = mid; } else latMax = mid;
    }
    even = !even;
    if (bit < 4) bit++;
    else { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Compass direction from a to b in whole degrees: 0 north, 90 east, 180 south, 270 west. */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const dLng = (bLng - aLng) * r;
  const y = Math.sin(dLng) * Math.cos(bLat * r);
  const x = Math.cos(aLat * r) * Math.sin(bLat * r) - Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos(dLng);
  return Math.round((Math.atan2(y, x) / r + 360) % 360) % 360;
}

/** Ray-casting test against the outer ring of a GeoJSON Polygon ([lng, lat] pairs). */
export function pointInPolygon(lat: number, lng: number, polygon: unknown): boolean {
  const ring = (polygon as { type?: string; coordinates?: number[][][] })?.coordinates?.[0];
  if (!Array.isArray(ring)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
