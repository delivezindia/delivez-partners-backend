import type { PartnerRole } from '@delivez/db';
import type { MessageChannel } from '../messaging/messaging.service';

export interface OffApp {
  channels: MessageChannel[];
  /** Only these partner roles; unset = anyone with a phone (customers, invited staff). */
  roles?: PartnerRole[];
  /** Only when no push reached any of their devices (customers who never turned alerts on). */
  whenNoPush?: boolean;
}

/** Whether a notification also goes out by SMS / WhatsApp to this person. */
export function sendOffApp(offApp: OffApp | undefined, to: { phone?: string; role?: PartnerRole }, pushReached: boolean) {
  if (!offApp || !to.phone) return false;
  if (offApp.roles && !(to.role && offApp.roles.includes(to.role))) return false;
  return !(offApp.whenNoPush && pushReached);
}
