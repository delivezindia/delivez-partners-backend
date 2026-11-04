import type { Prisma, StoreType, Vertical } from '@delivez/db';

/** Street carts and society vendors: the customer app lists them under Rush, not under Local stores. */
export const VENDOR_TYPES: StoreType[] = ['STREET_VENDOR', 'SOCIETY_VENDOR'];

/** Which shops a customer list of one kind of shop shows (every kind when none is asked for). */
export function kindWhere(vertical?: Vertical): Prisma.StoreWhereInput {
  if (!vertical) return {};
  return vertical === 'LOCAL_STORES' ? { vertical, storeType: { notIn: VENDOR_TYPES } } : { vertical };
}

/** The same rule for a shop that is already loaded. */
export const countsAs = (s: { vertical: Vertical; storeType: StoreType }, vertical: Vertical) =>
  s.vertical === vertical && !(vertical === 'LOCAL_STORES' && VENDOR_TYPES.includes(s.storeType));
