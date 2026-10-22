import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KvService } from '../../common/kv/kv.service';
import { ApiError } from '../../common/api-exception.filter';
import { haversineKm, pointInPolygon } from '../../common/geo';

export interface GeocodeResult {
  label: string;
  line1: string;
  pincode: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}

export interface ResolvedLocation {
  cityId: string;
  cityName: string;
  state: string;
  zoneId: string | null;
  zoneName: string | null;
  /** HIGH: pincode and pin agree on a live zone · MEDIUM: one of them matches · LOW: only near a live city */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  serviceable: boolean;
}

const NEAREST_CITY_MAX_KM = 60;

/**
 * Geocoding uses OpenStreetMap Nominatim in dev (no key needed, low rate limit).
 * Swap to Google Geocoding (plan §3.2) by implementing the same two methods behind GOOGLE_MAPS_API_KEY.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvService,
  ) {}

  async search(query: string): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'in', limit: '6' });
    const rows = await this.nominatim<NominatimPlace[]>(`search?${params}`);
    return rows.map(toResult);
  }

  async reverse(lat: number, lng: number): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', addressdetails: '1', zoom: '18' });
    const row = await this.nominatim<NominatimPlace & { error?: string }>(`reverse?${params}`);
    return row && !row.error ? toResult(row) : null;
  }

  async pincode(code: string) {
    const pin = await this.prisma.pincode.findUnique({
      where: { code },
      include: { city: { select: { id: true, name: true, state: true } }, zone: { select: { id: true, name: true } } },
    });
    return pin
      ? { code, serviceable: pin.serviceable, city: pin.city, zone: pin.zone }
      : { code, serviceable: false, city: null, zone: null };
  }

  /** Maps a pinned location to a Delivez city/zone. Throws if no live city is near. */
  async resolveLocation(lat: number, lng: number, pincode: string): Promise<ResolvedLocation> {
    const [pin, zones] = await Promise.all([
      this.prisma.pincode.findUnique({ where: { code: pincode }, include: { city: true } }),
      this.prisma.zone.findMany({ where: { isActive: true, city: { isActive: true } }, include: { city: true } }),
    ]);
    const zone = zones.find((z) => pointInPolygon(lat, lng, z.polygon)) ?? null;

    if (pin || zone) {
      const city = pin?.city ?? zone!.city;
      const confidence = pin && zone && pin.zoneId === zone.id ? 'HIGH' : 'MEDIUM';
      return {
        cityId: city.id,
        cityName: city.name,
        state: city.state,
        zoneId: zone?.id ?? pin?.zoneId ?? null,
        zoneName: zone?.name ?? null,
        confidence,
        serviceable: !!zone && (pin?.serviceable ?? true),
      };
    }

    const cities = await this.prisma.city.findMany({ where: { isActive: true } });
    const nearest = cities
      .map((c) => ({ c, km: haversineKm(lat, lng, c.centerLat, c.centerLng) }))
      .sort((a, b) => a.km - b.km)[0];
    if (!nearest || nearest.km > NEAREST_CITY_MAX_KM) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CITY_NOT_SERVED',
        "Delivez isn't live in your city yet. We'll reach out as soon as we launch there.",
      );
    }
    return {
      cityId: nearest.c.id,
      cityName: nearest.c.name,
      state: nearest.c.state,
      zoneId: null,
      zoneName: null,
      confidence: 'LOW',
      serviceable: false,
    };
  }

  private async nominatim<T>(path: string): Promise<T> {
    const cacheKey = `geo:nominatim:${path}`;
    const cached = await this.kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/${path}`, {
        headers: { 'user-agent': 'DelivezPartners/0.1 (local development)', 'accept-language': 'en' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as T;
      await this.kv.set(cacheKey, JSON.stringify(body), 24 * 60 * 60);
      return body;
    } catch (err) {
      this.logger.warn(`Geocoding failed: ${(err as Error).message}`);
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'GEOCODING_UNAVAILABLE', 'Address lookup is unavailable. Drop the pin and type the address.');
    }
  }
}

interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

function toResult(p: NominatimPlace): GeocodeResult {
  const a = p.address ?? {};
  const line1 = [a.house_number, a.road ?? a.pedestrian, a.neighbourhood ?? a.suburb].filter(Boolean).join(', ');
  return {
    label: p.display_name,
    line1: line1 || p.display_name.split(',').slice(0, 2).join(','),
    pincode: a.postcode?.replace(/\s/g, '') ?? null,
    city: a.city ?? a.town ?? a.state_district ?? null,
    state: a.state ?? null,
    lat: Number(p.lat),
    lng: Number(p.lon),
  };
}
