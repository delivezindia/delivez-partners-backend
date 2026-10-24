import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { FulfilmentType, PaymentMode } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { samplePrescriptionPdf } from '../lab-bookings/lab-simulator.service';
import type { OrderActor } from './order-state.service';
import { OrdersService } from './orders.service';

const NAMES = ['Aarav Sharma', 'Priya Nair', 'Rahul Verma', 'Ananya Rao', 'Vikram Singh', 'Sneha Iyer', 'Karthik Reddy', 'Divya Menon', 'Arjun Patel', 'Meera Kulkarni'];
const LANDMARKS = ['Near metro station', 'Opp. park', 'Next to bank', 'Behind temple', 'Above pharmacy', 'Gate 2'];

/**
 * Dev-only order generator (plan §10): creates PLACED orders with random in-stock items from the store's
 * own catalog, so the order screens can be built and tested before the customer app exists.
 * Orders are flagged isTestOrder and use dev customers (+91 70000 000xx).
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  async simulate(storeId: string, opts: { count: number; fulfilment: 'DELIVERY' | 'PICKUP' | 'ANY'; payment: 'COD' | 'UPI' | 'ANY'; placedSecondsAgo: number; rx?: 'YES' | 'NO' }, actor: OrderActor) {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    if (store.openState === 'CLOSED') throw new ApiError(HttpStatus.CONFLICT, 'STORE_CLOSED', 'Open the store to receive orders');

    const now = new Date();
    const products = await this.prisma.product.findMany({
      where: { storeId, deletedAt: null, isAvailable: true, OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] },
      include: { inventory: true, variants: true },
    });
    const inStock = products.filter((p) => !p.inventory?.trackStock || p.inventory.stockQty - p.inventory.reservedQty >= 2);
    const sellable = inStock.filter((p) => !p.prescriptionRequired);
    const rxOnes = inStock.filter((p) => p.prescriptionRequired);
    const wantRx = opts.rx === 'YES';
    if (wantRx && (store.vertical !== 'PHARMACY' || !rxOnes.length)) throw new ApiError(HttpStatus.CONFLICT, 'NO_RX_ITEMS', 'Mark a medicine as Schedule H / prescription required first');
    if (!sellable.length) throw new ApiError(HttpStatus.CONFLICT, 'NOTHING_TO_ORDER', 'No available items with stock to order');

    const created = [];
    for (let n = 0; n < opts.count; n++) {
      const fulfilment: FulfilmentType = opts.fulfilment === 'ANY' ? (store.supportsDelivery && (!store.supportsPickup || Math.random() < 0.7) ? 'DELIVERY' : 'PICKUP') : opts.fulfilment;
      const payment: PaymentMode = opts.payment === 'ANY' ? (Math.random() < 0.6 ? 'UPI' : 'COD') : opts.payment;
      const plain = shuffle(sellable).slice(0, randomInt(wantRx ? 0 : 1, Math.min(wantRx ? 1 : 3, sellable.length) + 1));
      const picks = wantRx ? [rxOnes[randomInt(0, rxOnes.length)], ...plain] : plain;
      const who = randomInt(0, NAMES.length);
      let prescriptionFileKeys: string[] | undefined;
      if (wantRx) {
        const key = `stores/${storeId}/rx/${randomUUID()}.pdf`;
        this.storage.putFile(key, samplePrescriptionPdf(NAMES[who], randomInt(20, 70), picks.filter((p) => p.prescriptionRequired).map((p) => p.name), 'Rx:'));
        prescriptionFileKeys = [key];
      }
      created.push(
        await this.orders.create(
          {
            storeId,
            channel: 'LOCAL_APP',
            fulfilmentType: fulfilment,
            customer: { phone: `+9170000000${String(who).padStart(2, '0')}`, name: NAMES[who] },
            items: picks.map((p) => ({ productId: p.id, qty: randomInt(1, 3), variantId: p.variants.length ? p.variants[randomInt(0, p.variants.length)].id : undefined })),
            paymentMode: payment,
            address: fulfilment === 'DELIVERY' ? nearby(store.lat!, store.lng!, Math.min(store.deliveryRadiusKm, 2) * 0.8, store.pincode ?? '560001') : undefined,
            note: Math.random() < 0.3 ? 'Please ring the bell, don’t call' : undefined,
            isTestOrder: true,
            prescriptionFileKeys,
            placedSecondsAgo: opts.placedSecondsAgo,
          },
          actor,
        ),
      );
    }
    return { orders: created };
  }
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** A random drop point within `km` of the store. */
function nearby(lat: number, lng: number, km: number, pincode: string) {
  const r = (km * Math.sqrt(Math.random())) / 111;
  const t = Math.random() * 2 * Math.PI;
  return {
    line1: `${randomInt(1, 400)}, ${randomInt(1, 20)}th Cross`,
    landmark: LANDMARKS[randomInt(0, LANDMARKS.length)],
    pincode,
    lat: lat + r * Math.cos(t),
    lng: lng + (r * Math.sin(t)) / Math.cos((lat * Math.PI) / 180),
  };
}
