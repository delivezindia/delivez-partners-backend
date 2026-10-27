import { SLA } from '../orders/sla';

/*
 * Store health for account managers (pure, unit tested). Everything is computed from real orders,
 * reviews, doorstep returns and tickets — no guessed numbers.
 *
 *  - SLA %: orders that met the order SLA (accepted within 3 min, ready within the promised time + 10 min,
 *    not ended by the store). Orders the customer / Delivez ended before the shop accepted don't count.
 *  - Churn risk 0–100: weighted mix of SLA breaches 30 · order drop 25 · prep variance 20 · cancellations 15 · complaints 10.
 */

export const WINDOW_DAYS = 7;
export const WEIGHTS = { SLA: 0.3, ORDER_DROP: 0.25, PREP_VARIANCE: 0.2, CANCELLATIONS: 0.15, COMPLAINTS: 0.1 } as const;
export type Factor = keyof typeof WEIGHTS;
export const RISK = { HIGH: 70, WATCH: 40 } as const;
/** Flags shown on the SLA screen. */
export const FLAGS = { PREP_UP_MINUTES: 5, RIDER_WAIT_MINUTES: 8, FOOD_WAIT_MINUTES: 8 } as const;
/** Guardrail: an account manager can move prep time by at most this much per change, inside 5–90 min. */
export const PREP_STEP_MAX = 10;
export const PREP_MIN = 5;
export const PREP_MAX = 90;

export interface HealthOrder {
  placedAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  promisedPrepMinutes: number | null;
  cancelFault: string | null;
  riderArrivedAt: Date | null;
}

export type Badge = 'HIGH' | 'WATCH' | 'STABLE' | 'NO_DATA';
export interface WindowStats {
  orders: number;
  slaPct: number | null;
  cancelPct: number | null;
  /** Average minutes ready after the promised time (negative = early). */
  prepVariance: number | null;
  avgPrep: number | null;
  avgPromised: number | null;
  /** Average minutes the rider waited at the shop for food. */
  riderWait: number | null;
  /** Average minutes ready food waited for a rider. */
  foodWait: number | null;
  timed: number;
}

const min = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Did this order meet the SLA? null = doesn't count (ended by someone else before the shop acted, or still waiting). */
export function slaMet(o: HealthOrder): boolean | null {
  if (o.cancelFault === 'STORE') return false;
  if (!o.acceptedAt) return null;
  if (min(o.acceptedAt, o.placedAt) > SLA.ACCEPT_SECONDS / 60) return false;
  if (o.readyAt && o.promisedPrepMinutes != null && min(o.readyAt, o.acceptedAt) - o.promisedPrepMinutes > SLA.PREP_LATE_MINUTES) return false;
  return true;
}

export function windowStats(orders: HealthOrder[], promisedShift = 0): WindowStats {
  const judged = orders
    .map((o) => slaMet(promisedShift ? { ...o, promisedPrepMinutes: o.promisedPrepMinutes == null ? null : o.promisedPrepMinutes + promisedShift } : o))
    .filter((x): x is boolean => x !== null);
  // Bad clocks (ready before accepted) would skew prep time, so those orders are left out.
  const timed = orders.filter((o) => o.acceptedAt && o.readyAt && o.promisedPrepMinutes != null && o.readyAt >= o.acceptedAt);
  const prep = timed.map((o) => min(o.readyAt!, o.acceptedAt!));
  const withRider = orders.filter((o) => o.readyAt && o.riderArrivedAt);
  return {
    orders: orders.length,
    slaPct: judged.length ? Math.round((judged.filter(Boolean).length / judged.length) * 100) : null,
    cancelPct: orders.length ? round1((orders.filter((o) => o.cancelFault === 'STORE').length / orders.length) * 100) : null,
    prepVariance: round1(avg(timed.map((o, i) => prep[i] - o.promisedPrepMinutes! - promisedShift))),
    avgPrep: round1(avg(prep)),
    avgPromised: round1(avg(timed.map((o) => o.promisedPrepMinutes! + promisedShift))),
    riderWait: round1(avg(withRider.map((o) => Math.max(0, min(o.readyAt!, o.riderArrivedAt!))))),
    foodWait: round1(avg(withRider.map((o) => Math.max(0, min(o.riderArrivedAt!, o.readyAt!))))),
    timed: timed.length,
  };
}

export interface HealthInput {
  current: HealthOrder[];
  previous: HealthOrder[];
  /** Low ratings, doorstep returns and customer tickets in the current window. */
  complaints: number;
}

export interface Health {
  current: WindowStats;
  previous: WindowStats;
  ordersPerDay: number;
  orderDropPct: number;
  complaints: number;
  slaTrend: 'UP' | 'DOWN' | 'FLAT';
  risk: number | null;
  badge: Badge;
  /** Contribution of each factor (points out of the risk score, and the factor's own 0–100 severity). */
  breakdown: { factor: Factor; weight: number; severity: number; points: number }[];
  flags: ('PREP_UP' | 'RIDER_WAIT' | 'FOOD_WAIT')[];
}

export function health(i: HealthInput): Health {
  const cur = windowStats(i.current);
  const prev = windowStats(i.previous);
  const orderDropPct = prev.orders >= 5 ? Math.max(0, Math.round(((prev.orders - cur.orders) / prev.orders) * 100)) : 0;
  const severity: Record<Factor, number> = {
    SLA: cur.slaPct == null ? 0 : clamp01((95 - cur.slaPct) / 25),
    ORDER_DROP: clamp01(orderDropPct / 50),
    PREP_VARIANCE: cur.prepVariance == null ? 0 : clamp01(cur.prepVariance / 10),
    CANCELLATIONS: cur.cancelPct == null ? 0 : clamp01(cur.cancelPct / 15),
    COMPLAINTS: cur.orders ? clamp01(i.complaints / cur.orders / 0.1) : 0,
  };
  const noData = cur.orders === 0 && prev.orders === 0;
  const breakdown = (Object.keys(WEIGHTS) as Factor[]).map((f) => ({
    factor: f,
    weight: Math.round(WEIGHTS[f] * 100),
    severity: Math.round(severity[f] * 100),
    points: Math.round(WEIGHTS[f] * severity[f] * 100),
  }));
  const risk = noData
    ? null
    : Math.min(
        100,
        breakdown.reduce((s, b) => s + b.points, 0),
      );
  const flags: Health['flags'] = [];
  if (cur.avgPrep != null && prev.avgPrep != null && cur.avgPrep - prev.avgPrep > FLAGS.PREP_UP_MINUTES) flags.push('PREP_UP');
  if (cur.riderWait != null && cur.riderWait > FLAGS.RIDER_WAIT_MINUTES) flags.push('RIDER_WAIT');
  if (cur.foodWait != null && cur.foodWait > FLAGS.FOOD_WAIT_MINUTES) flags.push('FOOD_WAIT');
  return {
    current: cur,
    previous: prev,
    ordersPerDay: Math.round((cur.orders / WINDOW_DAYS) * 10) / 10,
    orderDropPct,
    complaints: i.complaints,
    slaTrend: cur.slaPct == null || prev.slaPct == null ? 'FLAT' : cur.slaPct - prev.slaPct > 2 ? 'UP' : prev.slaPct - cur.slaPct > 2 ? 'DOWN' : 'FLAT',
    risk,
    badge: risk == null ? 'NO_DATA' : risk >= RISK.HIGH ? 'HIGH' : risk >= RISK.WATCH ? 'WATCH' : 'STABLE',
    breakdown,
    flags,
  };
}

export type SuggestionKind = 'PREP_UP' | 'PREP_DOWN' | 'ESCALATE_RIDERS' | 'VISIT' | 'CALL_COMPLAINTS' | 'CALL_REJECTIONS';
export interface Suggestion {
  kind: SuggestionKind;
  title: string;
  impact: string;
  /** For prep changes: minutes to add (negative = remove). */
  minutes?: number;
}

/** Rules, not guesses: each suggestion is backed by a number from this store's last 7 days. */
export function suggestions(h: Health, orders: HealthOrder[], storePrep: number): Suggestion[] {
  const out: Suggestion[] = [];
  const v = h.current.prepVariance;
  if (v != null && h.current.timed >= 3 && v > 3) {
    const n = Math.max(1, Math.min(PREP_STEP_MAX, Math.round(v)));
    const after = windowStats(orders, n).slaPct;
    out.push({
      kind: 'PREP_UP',
      minutes: Math.min(n, PREP_MAX - storePrep),
      title: `Increase prep time by ${n} min`,
      impact: `Orders are ready ${v} min after the promise on average. With ${n} more minutes, SLA on the last 7 days would be ${h.current.slaPct}% → ${after}%.`,
    });
  } else if (v != null && h.current.timed >= 3 && v < -8) {
    const n = Math.max(1, Math.min(PREP_STEP_MAX, Math.round(-v / 2)));
    out.push({
      kind: 'PREP_DOWN',
      minutes: -Math.min(n, storePrep - PREP_MIN),
      title: `Reduce prep time by ${n} min`,
      impact: `Orders are ready ${-v} min early on average — customers would see ETAs ${n} min shorter.`,
    });
  }
  if (h.current.foodWait != null && h.current.foodWait > FLAGS.FOOD_WAIT_MINUTES)
    out.push({
      kind: 'ESCALATE_RIDERS',
      title: 'Escalate rider delays to ops',
      impact: `Ready food waits ${h.current.foodWait} min for a rider on average — ops can dispatch earlier or add riders here.`,
    });
  if (h.orderDropPct >= 30) out.push({ kind: 'VISIT', title: 'Schedule a visit', impact: `Orders are down ${h.orderDropPct}% on the week before (${h.previous.orders} → ${h.current.orders}).` });
  if (h.complaints >= 2) out.push({ kind: 'CALL_COMPLAINTS', title: 'Go through complaints with the owner', impact: `${h.complaints} complaints (low ratings, returns, tickets) in 7 days.` });
  if ((h.current.cancelPct ?? 0) >= 10) out.push({ kind: 'CALL_REJECTIONS', title: 'Call about rejected / missed orders', impact: `${h.current.cancelPct}% of orders ended by the store in 7 days.` });
  return out;
}

const SCRIPT: Record<Factor, (h: Health) => string> = {
  SLA: (h) => `Only ${h.current.slaPct}% of your orders met the time limits this week. Which part slows you down — accepting, or getting food ready?`,
  ORDER_DROP: (h) => `Your orders dropped ${h.orderDropPct}% compared with last week (${h.previous.orders} → ${h.current.orders}). Has anything changed — menu, hours, staff?`,
  PREP_VARIANCE: (h) => `Food is ready about ${h.current.prepVariance} min after the time you promise. Shall we set a prep time you can always meet?`,
  CANCELLATIONS: (h) => `${h.current.cancelPct}% of orders were rejected or missed. Are items running out, or is the tablet unattended at rush hour?`,
  COMPLAINTS: (h) => `Customers raised ${h.complaints} complaints this week. Let’s go through them together.`,
};

/** A short call script from the biggest risk factors. */
export function callScript(h: Health, storeName: string, amName: string): string[] {
  const top = h.breakdown
    .filter((b) => b.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2);
  return [
    `Hi, this is ${amName}, your account manager at Delivez. I’m calling about ${storeName}.`,
    ...(top.length ? top.map((b) => SCRIPT[b.factor](h)) : ['Your numbers look good this week — anything we can help you with?']),
    'What can we change from our side to help?',
    'I’ll note this and call back to check how it’s going.',
  ];
}
