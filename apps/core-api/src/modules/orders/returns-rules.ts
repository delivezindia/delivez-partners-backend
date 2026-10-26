// Doorstep return window (pure rules, unit tested). After a delivery the rider waits a few minutes while the
// customer checks the items; damaged / wrong / expired / poor items go back with the rider, missing ones are
// refunded. Only for shops whose goods can be checked and taken back — not cooked food, medicines or lab tests.

export const RETURN_WINDOW_MINUTES = 5;
export const RETURNABLE_VERTICALS = ['GROCERY', 'LOCAL_STORES'];
export const RETURN_REASONS = ['DAMAGED', 'WRONG_ITEM', 'EXPIRED', 'POOR_QUALITY', 'MISSING'] as const;
export type ReturnReasonCode = (typeof RETURN_REASONS)[number];

export const returnsAllowed = (vertical: string, fulfilmentType: string) => RETURNABLE_VERTICALS.includes(vertical) && fulfilmentType === 'DELIVERY';

export type WindowState = 'NONE' | 'OPEN' | 'CLOSED';
export function windowState(o: { returnWindowEndsAt: Date | null; returnWindowClosedAt: Date | null }, now = new Date()): WindowState {
  if (!o.returnWindowEndsAt) return 'NONE';
  if (o.returnWindowClosedAt || o.returnWindowEndsAt <= now) return 'CLOSED';
  return 'OPEN';
}

export interface ReturnableItem {
  id: string;
  qty: number;
  returnedQty: number;
  unitPrice: number;
  isOutOfStock: boolean;
}
export interface ReturnRequest {
  itemId: string;
  qty: number;
  reason: ReturnReasonCode;
}
export type ReturnCheck =
  | { ok: true; lines: (ReturnRequest & { amount: number })[]; total: number }
  | { ok: false; code: 'NOTHING_TO_RETURN' | 'ITEM_NOT_ON_ORDER' | 'TOO_MANY' | 'DUPLICATE_ITEM'; message: string };

/** What can come back, and the refund for it (item price × quantity). */
export function checkReturn(items: ReturnableItem[], req: ReturnRequest[]): ReturnCheck {
  if (!req.length) return { ok: false, code: 'NOTHING_TO_RETURN', message: 'Pick at least one item' };
  const seen = new Set<string>();
  const lines: (ReturnRequest & { amount: number })[] = [];
  for (const r of req) {
    if (seen.has(r.itemId)) return { ok: false, code: 'DUPLICATE_ITEM', message: 'Each item once, with the total quantity' };
    seen.add(r.itemId);
    const it = items.find((i) => i.id === r.itemId && !i.isOutOfStock);
    if (!it) return { ok: false, code: 'ITEM_NOT_ON_ORDER', message: 'That item wasn’t delivered on this order' };
    const left = it.qty - it.returnedQty;
    if (r.qty < 1 || r.qty > left) return { ok: false, code: 'TOO_MANY', message: left ? `Only ${left} of that item can be returned` : 'That item was already returned' };
    lines.push({ ...r, amount: it.unitPrice * r.qty });
  }
  return { ok: true, lines, total: lines.reduce((n, l) => n + l.amount, 0) };
}
