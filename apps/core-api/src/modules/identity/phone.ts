import { z } from 'zod';

// Accepts "9845012345", "+91 98450 12345", "09845012345"; normalises to E.164 +91XXXXXXXXXX.
export const indianPhone = z
  .string()
  .transform((raw) => raw.replace(/[\s\-()]/g, ''))
  .transform((p) => {
    if (/^[6-9]\d{9}$/.test(p)) return `+91${p}`;
    if (/^0[6-9]\d{9}$/.test(p)) return `+91${p.slice(1)}`;
    if (/^91[6-9]\d{9}$/.test(p)) return `+${p}`;
    return p;
  })
  .refine((p) => /^\+91[6-9]\d{9}$/.test(p), { message: 'Enter a valid 10-digit Indian mobile number' });

export function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 5)}*****${phone.slice(-2)}` : phone;
}
