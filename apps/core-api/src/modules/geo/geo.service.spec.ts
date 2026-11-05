import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiError } from '../../common/api-exception.filter';
import { GeoService, LOOKUPS_PER_WINDOW } from './geo.service';

/** The KV store in memory. */
function fakeKv() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    incr: async (k: string) => {
      const n = Number(m.get(k) ?? 0) + 1;
      m.set(k, String(n));
      return n;
    },
  };
}

const PLACE = { display_name: 'Viram Khand 1, Gomti Nagar, Lucknow', lat: '26.8503', lon: '81.0049', address: { road: 'Viram Khand 1', suburb: 'Gomti Nagar', city: 'Lucknow', postcode: '226010' } };

describe('GeoService lookups', () => {
  const realFetch = globalThis.fetch;
  let calls: string[];
  let kv: ReturnType<typeof fakeKv>;
  let geo: GeoService;
  beforeEach(() => {
    calls = [];
    // Nominatim answers a search with a list and a reverse lookup with one place.
    globalThis.fetch = (async (url: string) => (calls.push(String(url)), new Response(JSON.stringify(/\/search\?/.test(String(url)) ? [PLACE] : PLACE)))) as typeof fetch;
    kv = fakeKv();
    geo = new GeoService({} as never, kv as never);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('turns a point into an address', async () => {
    const r = await geo.reverse(26.8503, 81.0049, '1.2.3.4');
    assert.equal(r?.line1, 'Viram Khand 1, Gomti Nagar');
    assert.equal(r?.city, 'Lucknow');
  });

  it('rounds the point to about a metre, so the same doorstep is one cached lookup', async () => {
    await geo.reverse(26.850312, 81.004934, '1.2.3.4');
    assert.match(calls[0], /lat=26\.85031&lon=81\.00493&/);
  });

  it('refuses a visitor who used up their new lookups, without calling Nominatim', async () => {
    kv.m.set('geo:lookups:1.2.3.4', String(LOOKUPS_PER_WINDOW));
    await assert.rejects(geo.reverse(26.8503, 81.0049, '1.2.3.4'), (e: unknown) => e instanceof ApiError && e.code === 'GEOCODING_RATE_LIMITED' && e.getStatus() === 429);
    assert.equal(calls.length, 0);
  });

  it('still answers that visitor from the cache, and other visitors normally', async () => {
    await geo.reverse(26.8503, 81.0049, '5.6.7.8');
    kv.m.set('geo:lookups:1.2.3.4', String(LOOKUPS_PER_WINDOW));
    const cached = await geo.reverse(26.8503, 81.0049, '1.2.3.4');
    assert.equal(cached?.line1, 'Viram Khand 1, Gomti Nagar');
    assert.equal(calls.length, 1);
  });

  it('keeps Nominatim requests about a second apart', async () => {
    const t0 = Date.now();
    await geo.reverse(26.8503, 81.0049, '1.2.3.4');
    await geo.search('Jankipuram Lucknow', '1.2.3.4');
    assert.equal(calls.length, 2);
    assert.ok(Date.now() - t0 >= 950, `two lookups took ${Date.now() - t0} ms`);
  });
});
