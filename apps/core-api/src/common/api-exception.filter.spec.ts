import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { ApiError, ApiExceptionFilter } from './api-exception.filter';

/** Runs the filter on one exception and returns the status and error body it sent. */
function send(exception: unknown) {
  const out: { status?: number; body?: { error: { code: string; message: string } } } = {};
  const res = { status: (s: number) => ((out.status = s), res), json: (b: typeof out.body) => (out.body = b) };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ correlationId: 'req_test' }) }) } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return { status: out.status, code: out.body?.error.code, message: out.body?.error.message };
}

describe('ApiExceptionFilter', () => {
  it('keeps ApiError codes', () => {
    assert.deepEqual(send(new ApiError(HttpStatus.CONFLICT, 'CART_CHANGED', 'Some items changed')), { status: 409, code: 'CART_CHANGED', message: 'Some items changed' });
  });

  it('answers 413 for a body that is too large (not a 500)', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });
    assert.deepEqual(send(tooLarge), { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large' });
  });

  it('keeps the status of other request errors from middleware', () => {
    const charset = Object.assign(new Error('unsupported charset "UTF-7"'), { status: 415, type: 'charset.unsupported' });
    assert.deepEqual(send(charset), { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'The request could not be processed' });
  });

  it('still treats unknown errors as server errors', () => {
    Logger.overrideLogger(false);
    assert.deepEqual(send(new Error('boom')), { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    assert.equal(send(Object.assign(new Error('upstream'), { status: 502 })).status, 500);
  });
});
