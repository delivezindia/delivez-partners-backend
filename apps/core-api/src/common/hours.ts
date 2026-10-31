// Opening-hours evaluation in the store's city timezone (default Asia/Kolkata).
// Slots are same-day (closesAt > opensAt); overnight slots are entered as two slots.

export interface Slot {
  dayOfWeek: number; // 0 = Sun
  opensAt: string; // "HH:MM"
  closesAt: string;
  isClosed?: boolean;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dayOfWeek: WEEKDAYS[get('weekday')],
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`, // local calendar date
  };
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Whether the timings + holidays say the store is open at `now`. Stores without timings are treated as open. */
export function isWithinHours(slots: Slot[], holidays: Date[], now: Date, timeZone = 'Asia/Kolkata'): boolean {
  const { dayOfWeek, minutes, date } = localParts(now, timeZone);
  if (holidays.some((h) => h.toISOString().slice(0, 10) === date)) return false;
  if (slots.length === 0) return true;
  return slots.some((s) => !s.isClosed && s.dayOfWeek === dayOfWeek && minutes >= toMin(s.opensAt) && minutes < toMin(s.closesAt));
}

/**
 * When the slot the store is in right now ends ("HH:MM"), following back-to-back slots on the same day.
 * Null when it has no set hours or isn't within them.
 */
export function closingNow(slots: Slot[], now: Date, timeZone = 'Asia/Kolkata'): string | null {
  const { dayOfWeek, minutes } = localParts(now, timeZone);
  const today = slots.filter((s) => !s.isClosed && s.dayOfWeek === dayOfWeek);
  const slot = today.find((s) => minutes >= toMin(s.opensAt) && minutes < toMin(s.closesAt));
  if (!slot) return null;
  let end = slot.closesAt;
  for (;;) {
    const next = today.find((s) => s.opensAt === end && toMin(s.closesAt) > toMin(end));
    if (!next) return end;
    end = next.closesAt;
  }
}

/** Next opening time today/this week as "Mon 10:00", for friendly messages. */
export function nextOpening(slots: Slot[], now: Date, timeZone = 'Asia/Kolkata'): string | null {
  const { dayOfWeek, minutes } = localParts(now, timeZone);
  const names = Object.keys(WEEKDAYS);
  for (let offset = 0; offset < 7; offset++) {
    const d = (dayOfWeek + offset) % 7;
    const candidates = slots
      .filter((s) => !s.isClosed && s.dayOfWeek === d && (offset > 0 || toMin(s.opensAt) > minutes))
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    if (candidates[0]) return `${offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : names[d]} ${candidates[0].opensAt}`;
  }
  return null;
}
