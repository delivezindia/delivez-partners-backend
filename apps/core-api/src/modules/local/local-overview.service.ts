import { Injectable } from '@nestjs/common';
import type { Vertical } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import { DELIVERY_FEE } from '../orders/orders.service';
import { RETURN_WINDOW_MINUTES } from '../orders/returns-rules';

const RUNNING = ['LIVE', 'LIMITED'] as const;
const VERTICALS: Vertical[] = ['EAT', 'GROCERY', 'PHARMACY', 'DIAGNOSTICS', 'LOCAL_STORES'];
const TTL_MS = 60_000;
/** Shop types per category on the public page: the most common menu sections (cuisines for food). */
const TOP_TYPES = 9;
/** Catch-all menu sections that say nothing about what a shop sells. */
const GENERIC = new Set(['menu', 'tests', 'items', 'products', 'all', 'all items', 'other', 'others', 'general', 'misc', 'miscellaneous', 'uncategorised', 'uncategorized']);

export interface Overview {
  cities: { id: string; name: string; state: string; lat: number; lng: number; shops: number }[];
  verticals: Record<Vertical, { shops: number; types: { name: string; shops: number }[] }>;
  shops: number;
  /** paise, per order */
  deliveryFee: number;
  /** The doorstep check after a grocery / local-shop delivery. */
  doorCheckMinutes: number;
}

/**
 * The customer app's public page, from real data: which cities have running shops, how many of each kind,
 * and what those shops actually sell. Cached for a minute — it is read by every first-time visitor.
 */
@Injectable()
export class LocalOverviewService {
  private cache?: { at: number; value: Overview };

  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<Overview> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.value;
    const stores = await this.prisma.store.findMany({
      where: { status: { in: [...RUNNING] }, city: { isActive: true } },
      select: { id: true, vertical: true, cuisines: true, cityId: true, categories: { where: { isActive: true, products: { some: { isAvailable: true } } }, select: { name: true } } },
    });
    const cityIds = [...new Set(stores.map((s) => s.cityId!))];
    const cities = await this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true, state: true, centerLat: true, centerLng: true } });

    const verticals = Object.fromEntries(
      VERTICALS.map((v) => {
        const mine = stores.filter((s) => s.vertical === v);
        const counts = new Map<string, { name: string; shops: number }>();
        for (const s of mine) {
          // One vote per shop per type, matched case-insensitively ("Biryani" = "biryani").
          const names = v === 'EAT' && s.cuisines.length ? s.cuisines : s.categories.map((c) => c.name);
          for (const key of new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n && !GENERIC.has(n)))) {
            const cur = counts.get(key);
            if (cur) cur.shops++;
            else counts.set(key, { name: names.find((n) => n.trim().toLowerCase() === key)!.trim(), shops: 1 });
          }
        }
        const types = [...counts.values()].sort((a, b) => b.shops - a.shops || a.name.localeCompare(b.name)).slice(0, TOP_TYPES);
        return [v, { shops: mine.length, types }];
      }),
    ) as Overview['verticals'];

    const value: Overview = {
      cities: cities
        .map((c) => ({ id: c.id, name: titleCase(c.name), state: c.state, lat: c.centerLat, lng: c.centerLng, shops: stores.filter((s) => s.cityId === c.id).length }))
        .sort((a, b) => b.shops - a.shops),
      verticals,
      shops: stores.length,
      deliveryFee: DELIVERY_FEE,
      doorCheckMinutes: RETURN_WINDOW_MINUTES,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  /**
   * "Do you deliver to 560034?" A PIN we know (and mark serviceable) answers directly; otherwise a PIN in the same
   * postal district (first three digits) as a running shop counts. Exact shops come once they set a location.
   */
  async serviceable(pincode: string) {
    const [pin, nearby] = await Promise.all([
      this.prisma.pincode.findUnique({ where: { code: pincode }, select: { serviceable: true, city: { select: { id: true, name: true, isActive: true } } } }),
      this.prisma.store.findMany({ where: { status: { in: [...RUNNING] }, pincode: { startsWith: pincode.slice(0, 3) }, city: { isActive: true } }, select: { cityId: true, city: { select: { name: true } } } }),
    ]);
    const live = (await this.overview()).cities.map((c) => c.name);
    if (pin && (!pin.serviceable || !pin.city.isActive)) return { pincode, live: false, city: titleCase(pin.city.name), liveCities: live };
    const cityId = pin?.city.id ?? mostCommon(nearby.map((s) => s.cityId!));
    const shops = cityId ? nearby.filter((s) => s.cityId === cityId).length : 0;
    const city = pin?.city.name ?? nearby.find((s) => s.cityId === cityId)?.city?.name ?? null;
    return { pincode, live: shops > 0 || (!!pin && live.includes(titleCase(pin.city.name))), city: city ? titleCase(city) : null, liveCities: live };
  }
}

const titleCase = (s: string) => s.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
const mostCommon = (ids: string[]) => {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
