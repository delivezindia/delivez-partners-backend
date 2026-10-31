import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers.middleware';

function headersFor(path: string) {
  const h: Record<string, string> = {};
  let called = false;
  securityHeaders({ path } as Request, { setHeader: (k: string, v: string) => (h[k] = v) } as unknown as Response, () => (called = true));
  assert.ok(called, 'next() was not called');
  return h;
}

describe('securityHeaders', () => {
  it('sets nosniff, referrer policy and blocks framing', () => {
    const h = headersFor('/v1/local/orders');
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.equal(h['X-Frame-Options'], 'DENY');
  });

  it('lets uploaded files be framed (document and prescription previews)', () => {
    const h = headersFor('/v1/files/raw');
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['X-Frame-Options'], undefined);
  });
});
