import { SLA } from './sla';

/*
 * Live alert level for an order on the ops dashboard (pure, unit tested).
 *
 *   NORMAL   on track                                  green, no motion
 *   AT_RISK  > 3 min behind the stage's promise          amber, soft pulse
 *   LIKELY   > 5 min behind, or a rider waiting for food   orange, slow blink
 *   BREACHED past the SLA (10 min — the same limits the    red, fast pulse + one sound
 *            order SLA uses for PREP_LATE / NO_RIDER / DOOR_WAIT)
 *
 * New orders and prescriptions are judged on their accept / review timers instead.
 */

export type AlertLevel = 'NORMAL' | 'AT_RISK' | 'LIKELY' | 'BREACHED';
export type AlertKind = 'ACCEPT' | 'RX_REVIEW' | 'PREP' | 'NO_RIDER' | 'RIDER_TO_STORE' | 'DELIVERY' | 'DOOR';
export const LEVELS: AlertLevel[] = ['NORMAL', 'AT_RISK', 'LIKELY', 'BREACHED'];
export const rank = (l: AlertLevel) => LEVELS.indexOf(l);
/** Minutes behind the promise at which each level starts. */
export const BEHIND = { AT_RISK: 3, LIKELY: 5, BREACHED: SLA.PREP_LATE_MINUTES } as const;
/** Alerts at these levels are recorded for the audit log and need an acknowledgement. */
export const LOGGED: AlertLevel[] = ['LIKELY', 'BREACHED'];

export interface AlertOrder {
  status: string;
  fulfilmentType: string;
  placedAt: Date | null;
  createdAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  promisedPrepMinutes: number | null;
  promisedDeliveryAt: Date | null;
  currentEtaAt: Date | null;
  task: { status: string; assignedAt: Date | null; etaToPickupMin: number | null; arrivedPickupAt: Date | null; waitingStartedAt: Date | null; arrivedDropAt: Date | null } | null;
}

export interface OrderAlert {
  level: AlertLevel;
  kind: AlertKind;
  /** Short, specific line for the row, e.g. "Prep delayed by +7 min". */
  reason: string;
  /** When this stage breaches its SLA. */
  deadline: Date | null;
  /** Share of the stage's SLA budget used, 0–1 (drives the SLA bar). */
  progress: number;
  /** Minutes behind the promise (0 when on time). */
  behind: number;
}

const mins = (ms: number) => ms / 60_000;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const byBehind = (behind: number): AlertLevel => (behind > BEHIND.BREACHED ? 'BREACHED' : behind > BEHIND.LIKELY ? 'LIKELY' : behind > BEHIND.AT_RISK ? 'AT_RISK' : 'NORMAL');
const max = (a: AlertLevel, b: AlertLevel) => (rank(a) >= rank(b) ? a : b);
const r1 = (x: number) => Math.max(0, Math.round(x));
/** 7 → "7 min", 135 → "2 h 15 min", 3000 → "2 days". */
export const dur = (m: number) => { const x = r1(m); return x < 90 ? `${x} min` : x < 48 * 60 ? `${Math.floor(x / 60)} h ${x % 60} min` : `${Math.round(x / 1440)} days`; };

/** A budget timer (accept / prescription review): risk at 50% used, likely at 80%, breached when it runs out. */
function budget(kind: AlertKind, start: Date, budgetMin: number, now: Date, what: string): OrderAlert {
  const used = mins(now.getTime() - start.getTime());
  const p = used / budgetMin;
  const left = Math.max(0, budgetMin - used);
  const level: AlertLevel = p >= 1 ? 'BREACHED' : p >= 0.8 ? 'LIKELY' : p >= 0.5 ? 'AT_RISK' : 'NORMAL';
  const leftText = left >= 1 ? `${Math.ceil(left)} min` : `${Math.ceil(left * 60)} s`;
  return { level, kind, reason: level === 'NORMAL' ? `${what} — ${leftText} left` : `${what} — only ${leftText} left`, deadline: new Date(start.getTime() + budgetMin * 60_000), progress: clamp01(p), behind: 0 };
}

export function orderAlert(o: AlertOrder, now = new Date()): OrderAlert | null {
  const t = o.task;
  switch (o.status) {
    case 'PLACED':
      return budget('ACCEPT', o.placedAt ?? o.createdAt, SLA.ACCEPT_SECONDS / 60, now, 'Waiting for the shop to accept');
    case 'AWAITING_RX_REVIEW':
      return budget('RX_REVIEW', o.createdAt, SLA.RX_REVIEW_MINUTES, now, 'Prescription not reviewed');
    case 'ACCEPTED':
    case 'PREPARING':
    case 'READY_SOON': {
      if (!o.acceptedAt) return null;
      const promised = o.promisedPrepMinutes ?? 20;
      const due = o.acceptedAt.getTime() + promised * 60_000;
      const behind = mins(now.getTime() - due);
      let level = byBehind(behind);
      let reason = behind > 0 ? `Prep delayed by +${dur(behind)}` : `Ready in ${Math.ceil(-behind)} min`;
      // A rider already standing at the counter makes a late kitchen urgent.
      if (t && ['ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP'].includes(t.status)) {
        const waited = r1(mins(now.getTime() - (t.waitingStartedAt ?? t.arrivedPickupAt ?? now).getTime()));
        const waitedText = dur(waited);
        level = max(level, waited >= SLA.NO_RIDER_MINUTES ? 'BREACHED' : 'LIKELY');
        reason = `Rider waiting ${waitedText} · ${reason.toLowerCase()}`;
      }
      return { level, kind: 'PREP', reason, deadline: new Date(due + BEHIND.BREACHED * 60_000), progress: clamp01(mins(now.getTime() - o.acceptedAt.getTime()) / (promised + BEHIND.BREACHED)), behind: r1(behind) };
    }
    case 'READY': {
      if (o.fulfilmentType !== 'DELIVERY' || !o.readyAt) return null;
      if (!t || ['CREATED', 'SEARCHING_RIDER'].includes(t.status)) {
        const waited = mins(now.getTime() - o.readyAt.getTime());
        return { level: byBehind(waited), kind: 'NO_RIDER', reason: `Ready ${dur(waited)} — no rider yet`, deadline: new Date(o.readyAt.getTime() + SLA.NO_RIDER_MINUTES * 60_000), progress: clamp01(waited / SLA.NO_RIDER_MINUTES), behind: r1(waited) };
      }
      // Rider assigned but not at the shop yet: compare with the ETA they were given.
      if (['ASSIGNED', 'EN_ROUTE_TO_PICKUP'].includes(t.status) && t.assignedAt) {
        const due = t.assignedAt.getTime() + (t.etaToPickupMin ?? 10) * 60_000;
        const behind = mins(now.getTime() - due);
        const food = mins(now.getTime() - o.readyAt.getTime());
        return { level: byBehind(behind), kind: 'RIDER_TO_STORE', reason: behind > 0 ? `Rider late to the shop by ${dur(behind)} · food waiting ${dur(food)}` : `Rider on the way · food waiting ${dur(food)}`, deadline: new Date(due + BEHIND.BREACHED * 60_000), progress: clamp01(mins(now.getTime() - t.assignedAt.getTime()) / ((t.etaToPickupMin ?? 10) + BEHIND.BREACHED)), behind: r1(behind) };
      }
      return { level: 'NORMAL', kind: 'RIDER_TO_STORE', reason: 'Rider at the shop', deadline: null, progress: 0.5, behind: 0 };
    }
    case 'PICKED_UP':
    case 'OUT_FOR_DELIVERY': {
      if (!o.promisedDeliveryAt) return null;
      const eta = Math.max(now.getTime(), (o.currentEtaAt ?? o.promisedDeliveryAt).getTime());
      const behind = mins(eta - o.promisedDeliveryAt.getTime());
      const start = o.placedAt ?? o.createdAt;
      return {
        level: byBehind(behind),
        kind: 'DELIVERY',
        reason: behind > 0 ? `Delivery running ${dur(behind)} behind the promise` : 'On the way, on time',
        deadline: new Date(o.promisedDeliveryAt.getTime() + BEHIND.BREACHED * 60_000),
        progress: clamp01(mins(now.getTime() - start.getTime()) / (mins(o.promisedDeliveryAt.getTime() - start.getTime()) + BEHIND.BREACHED)),
        behind: r1(behind),
      };
    }
    case 'ARRIVED': {
      const at = t?.arrivedDropAt;
      if (!at) return null;
      const waited = mins(now.getTime() - at.getTime());
      return { level: byBehind(waited), kind: 'DOOR', reason: `Rider at the door ${dur(waited)}`, deadline: new Date(at.getTime() + SLA.DOOR_WAIT_MINUTES * 60_000), progress: clamp01(waited / SLA.DOOR_WAIT_MINUTES), behind: r1(waited) };
    }
    default:
      return null;
  }
}

/** Which inline actions a row offers at each level (spec §3). */
export const ROW_ACTIONS: Record<AlertLevel, ('VIEW' | 'CALL_STORE' | 'CALL_RIDER' | 'UPDATE_PREP' | 'ESCALATE' | 'SWAP_RIDER' | 'APOLOGY')[]> = {
  NORMAL: ['VIEW'],
  AT_RISK: ['VIEW', 'CALL_STORE'],
  LIKELY: ['CALL_STORE', 'CALL_RIDER', 'UPDATE_PREP'],
  BREACHED: ['ESCALATE', 'SWAP_RIDER', 'APOLOGY'],
};

/** Rider panel thresholds. */
export const RIDER = { OVERLOADED_TASKS: 3, OFFLINE_AFTER_MINUTES: 3 } as const;
