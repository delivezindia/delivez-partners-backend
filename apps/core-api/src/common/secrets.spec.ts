import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { serverSecret } from './secrets';

describe('serverSecret', () => {
  Logger.overrideLogger(false);

  it('uses the value from .env when set', () => {
    assert.equal(serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'production', FILE_URL_SECRET: 's3cret' }), 's3cret');
  });

  it('falls back to the dev value only outside production', () => {
    assert.equal(serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'development' }), 'dev');
  });

  it('never uses the dev value in production: derives one from the JWT key instead', () => {
    const a = serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'production', JWT_PRIVATE_KEY: 'key-1' });
    assert.notEqual(a, 'dev');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'production', JWT_PRIVATE_KEY: 'key-1' }), a, 'stable across restarts');
    assert.notEqual(serverSecret('OTP_PEPPER', 'dev', { NODE_ENV: 'production', JWT_PRIVATE_KEY: 'key-1' }), a, 'different per secret');
    assert.notEqual(serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'production', JWT_PRIVATE_KEY: 'key-2' }), a, 'different per server');
  });

  it('refuses to run in production with neither', () => {
    assert.throws(() => serverSecret('FILE_URL_SECRET', 'dev', { NODE_ENV: 'production' }), /required in production/);
  });
});
