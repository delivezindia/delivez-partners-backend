import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/api-exception.filter';
import { KvService } from '../../common/kv/kv.service';

export interface IfscBranch {
  ifsc: string;
  bank: string;
  branch: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const FOUND_TTL = 7 * 86_400;
const MISSING_TTL = 86_400;

/**
 * Bank branch lookup by IFSC (RBI data, via Razorpay's public IFSC directory — no key, no personal data sent).
 * Cached: a code is fetched at most once a week. `null` = the code doesn't exist; throws only when the
 * directory itself is unreachable, so callers can decide to carry on without it.
 */
@Injectable()
export class IfscService {
  private readonly logger = new Logger(IfscService.name);
  constructor(private readonly kv: KvService) {}

  async lookup(code: string): Promise<IfscBranch | null> {
    const ifsc = code.trim().toUpperCase();
    if (!IFSC_RE.test(ifsc)) return null;
    const cached = await this.kv.get(`ifsc:${ifsc}`);
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as IfscBranch);
    const base = process.env.IFSC_API_URL ?? 'https://ifsc.razorpay.com';
    let res: Response;
    try {
      res = await fetch(`${base}/${ifsc}`, { signal: AbortSignal.timeout(6000) });
    } catch (e) {
      this.logger.warn(`IFSC lookup unreachable: ${(e as Error).message}`);
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'IFSC_LOOKUP_UNAVAILABLE', 'Bank lookup is unavailable right now');
    }
    if (res.status === 404) {
      await this.kv.set(`ifsc:${ifsc}`, 'none', MISSING_TTL);
      return null;
    }
    if (!res.ok) throw new ApiError(HttpStatus.BAD_GATEWAY, 'IFSC_LOOKUP_UNAVAILABLE', 'Bank lookup is unavailable right now');
    const r = (await res.json()) as Record<string, string | undefined>;
    const branch: IfscBranch = { ifsc, bank: r.BANK ?? '', branch: r.BRANCH ?? null, city: r.CITY ?? null, state: r.STATE ?? null, address: r.ADDRESS ?? null };
    await this.kv.set(`ifsc:${ifsc}`, JSON.stringify(branch), FOUND_TTL);
    return branch;
  }

  /** For saving an account: unknown codes are refused; if the directory is down we don't block the partner. */
  async check(code: string): Promise<IfscBranch | null> {
    try {
      const b = await this.lookup(code);
      if (!b) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'IFSC_NOT_FOUND', 'This IFSC code doesn’t exist — check it on your cheque or passbook', { fieldErrors: { ifsc: ['IFSC not found'] } });
      return b;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IFSC_LOOKUP_UNAVAILABLE') return null;
      throw e;
    }
  }
}
