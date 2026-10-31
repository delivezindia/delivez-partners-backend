import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, Vertical } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { bearingDeg, haversineKm } from '../../common/geo';
import { closingNow, nextOpening } from '../../common/hours';
import { PrismaService } from '../../prisma/prisma.service';
import { imageUrl } from '../catalog/catalog.service';
import { travelMinutes } from '../orders/order-state.service';
import { DEFAULT_MAX_QTY, DELIVERY_FEE } from '../orders/orders.service';

/** Labs are still listed for walk-in slot booking up to this far (a lab visit, not an order pickup). */
const LAB_WALK_IN_KM = 10;
/** Soft-launch (LIMITED) shops deliver only close by. */
const LIMITED_RADIUS_KM = 2;
const RUNNING = ['LIVE', 'LIMITED'] as const;
const DEG_BOX = 0.15; // ~16 km pre-filter before the exact distance

const img = (k: string | null | undefined) => (k ? imageUrl(k) : null);

/** "tomorrow 09:00" → { day: 'tomorrow', time: '09:00' } so the app can show it in the customer's language. */
export function opening(text: string | null): { day: string; time: string } | null {
  const m = text?.match(/^(\S+) (\d{2}:\d{2})$/);
  return m ? { day: m[1], time: m[2] } : null;
}

/**
 * What a customer sees (Local app, L1): shops near an address and a shop's menu. Public — browsing needs no login.
 * Only LIVE / LIMITED shops that deliver to the address (home delivery only — no self-pickup).
 */
@Injectable()
export class LocalStoresService {
  constructor(private readonly prisma: PrismaService) {}

  async nearby(q: { lat: number; lng: number; vertical?: Vertical; q?: string }) {
    const rows = await this.prisma.store.findMany({
      where: {
        status: { in: [...RUNNING] },
        lat: { gte: q.lat - DEG_BOX, lte: q.lat + DEG_BOX },
        lng: { gte: q.lng - DEG_BOX, lte: q.lng + DEG_BOX },
        ...(q.vertical ? { vertical: q.vertical } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { cuisines: { has: q.q } },
                {
                  products: {
                    some: {
                      name: { contains: q.q, mode: 'insensitive' },
                      deletedAt: null,
                      isAvailable: true,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: { timings: true, city: { select: { name: true } } },
      take: 300,
    });
    const now = new Date();
    const stores = rows
      .map((s) => {
        const km = Math.round(haversineKm(q.lat, q.lng, s.lat!, s.lng!) * 10) / 10;
        const radius = s.status === 'LIMITED' ? Math.min(LIMITED_RADIUS_KM, s.deliveryRadiusKm) : s.deliveryRadiusKm;
        return { s, km, delivers: s.supportsDelivery && km <= radius };
      })
      .filter((x) => x.delivers || (x.s.vertical === 'DIAGNOSTICS' && x.s.supportsPickup && x.km <= LAB_WALK_IN_KM))
      .map(({ s, km, delivers }) => {
        const open = s.openState !== 'CLOSED';
        const prep = s.defaultPrepMinutes + (s.openState === 'BUSY' ? 10 : 0);
        return {
          id: s.id,
          slug: s.slug,
          name: s.name,
          vertical: s.vertical,
          storeType: s.storeType,
          cuisines: s.cuisines,
          description: s.description,
          logoUrl: img(s.logoUrl),
          coverUrl: img(s.coverUrl),
          area: [s.landmark, s.city?.name].filter(Boolean).join(', ') || null,
          distanceKm: km,
          /** Which way the shop is from the address (degrees, 0 = north), for maps of what's around. */
          bearing: bearingDeg(q.lat, q.lng, s.lat!, s.lng!),
          open,
          /** When today's opening hours end ("HH:MM"); null without set hours. */
          closesAt: open ? closingNow(s.timings, now) : null,
          busy: s.openState === 'BUSY',
          // Lab tests are booked into slots, so a closed lab can still take bookings.
          bookable: s.vertical === 'DIAGNOSTICS',
          opensAt: open ? null : opening(nextOpening(s.timings, now)),
          delivers,
          etaMinutes: delivers ? prep + travelMinutes(km) : prep,
          deliveryFee: delivers ? DELIVERY_FEE : 0,
          minOrderAmount: s.minOrderAmount,
          rating: s.ratingCount ? { avg: Math.round(s.avgRating * 10) / 10, count: s.ratingCount } : null,
        };
      })
      // Open shops first, then the ones that deliver here, then nearest.
      .sort((a, b) => Number(b.open) - Number(a.open) || Number(b.delivers) - Number(a.delivers) || a.distanceKm - b.distanceKm);
    const verticals = [...new Set(stores.map((s) => s.vertical))];
    return { stores, verticals };
  }

  /** A shop and its menu. With lat/lng the response says whether it delivers there. */
  async menu(idOrSlug: string, at?: { lat: number; lng: number }) {
    const where: Prisma.StoreWhereInput = /^[0-9a-f-]{36}$/i.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug };
    const s = await this.prisma.store.findFirst({
      where: { ...where, status: { in: [...RUNNING] } },
      include: {
        timings: true,
        city: { select: { name: true } },
        categories: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
        products: {
          where: { deletedAt: null, isAvailable: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            variants: true,
            addonGroups: { include: { addons: true } },
            inventory: true,
          },
        },
      },
    });
    if (!s) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'This shop isn’t taking orders on Delivez');
    const now = new Date();
    const km = at && s.lat != null && s.lng != null ? Math.round(haversineKm(at.lat, at.lng, s.lat, s.lng) * 10) / 10 : null;
    const radius = s.status === 'LIMITED' ? Math.min(LIMITED_RADIUS_KM, s.deliveryRadiusKm) : s.deliveryRadiusKm;
    const products = s.products.map((p) => {
      const paused = !!p.pausedUntil && p.pausedUntil > now;
      const left = p.inventory?.trackStock ? p.inventory.stockQty - p.inventory.reservedQty : null;
      return {
        id: p.id,
        categoryId: p.categoryId,
        name: p.name,
        description: p.description,
        imageUrl: p.images[0] ? imageUrl(p.images[0]) : null,
        price: p.price,
        mrp: p.mrp && p.mrp > p.price ? p.mrp : null,
        unit: p.unit,
        unitSize: p.unitSize,
        isVeg: p.isVeg,
        spiceLevel: p.spiceLevel,
        prescriptionRequired: p.prescriptionRequired,
        saltComposition: p.saltComposition,
        manufacturer: p.manufacturer,
        lab:
          s.vertical === 'DIAGNOSTICS'
            ? {
                sampleType: p.labSampleType,
                fastingHours: p.labFastingHours,
                reportHours: p.labReportHours,
                homeCollection: p.labHomeCollection,
                walkIn: p.labWalkIn,
                parameters: p.labParameters,
                preparation: p.labPreparation,
              }
            : null,
        variants: p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceDiff: v.priceDiff,
          isDefault: v.isDefault,
        })),
        addonGroups: p.addonGroups.map((g) => ({
          id: g.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          addons: g.addons.map((a) => ({
            id: a.id,
            name: a.name,
            price: a.price,
            isVeg: a.isVeg,
          })),
        })),
        available: !paused && (left == null || left > 0),
        // Shows "Only 3 left" without revealing the stock count above a handful.
        fewLeft: left != null && left > 0 && left <= 5 ? left : null,
        maxQty: Math.min(p.maxQtyPerOrder ?? DEFAULT_MAX_QTY, left ?? DEFAULT_MAX_QTY),
      };
    });
    const used = new Set(products.map((p) => p.categoryId));
    return {
      store: {
        id: s.id,
        slug: s.slug,
        name: s.name,
        vertical: s.vertical,
        cuisines: s.cuisines,
        description: s.description,
        logoUrl: img(s.logoUrl),
        coverUrl: img(s.coverUrl),
        address: [s.addressLine1, s.landmark, s.city?.name].filter(Boolean).join(', '),
        open: s.openState !== 'CLOSED',
        busy: s.openState === 'BUSY',
        opensAt: s.openState === 'CLOSED' ? opening(nextOpening(s.timings, now)) : null,
        supportsDelivery: s.supportsDelivery,
        supportsPickup: s.supportsPickup,
        collectionFee: s.vertical === 'DIAGNOSTICS' ? s.collectionFee : 0,
        distanceKm: km,
        delivers: km == null ? null : s.supportsDelivery && km <= radius,
        etaMinutes: s.defaultPrepMinutes + (s.openState === 'BUSY' ? 10 : 0) + (km != null ? travelMinutes(km) : 0),
        deliveryFee: DELIVERY_FEE,
        packagingFee: s.packagingFee,
        minOrderAmount: s.minOrderAmount,
        rating: s.ratingCount ? { avg: Math.round(s.avgRating * 10) / 10, count: s.ratingCount } : null,
      },
      categories: [...s.categories.filter((c) => used.has(c.id)).map((c) => ({ id: c.id, name: c.name })), ...(used.has(null) ? [{ id: null, name: 'More' }] : [])],
      products,
    };
  }
}
