import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sendOffApp } from './off-app';

describe('sendOffApp', () => {
  const phone = '+919800000001';
  it('needs a phone and a channel set', () => {
    assert.equal(sendOffApp(undefined, { phone }, false), false);
    assert.equal(sendOffApp({ channels: ['SMS'] }, {}, false), false);
  });
  it('partner messages only reach the listed roles', () => {
    assert.equal(sendOffApp({ channels: ['SMS'], roles: ['OWNER'] }, { phone, role: 'OWNER' }, true), true);
    assert.equal(sendOffApp({ channels: ['SMS'], roles: ['OWNER'] }, { phone, role: 'COUNTER_STAFF' }, false), false);
    assert.equal(sendOffApp({ channels: ['SMS'], roles: ['OWNER'] }, { phone }, false), false);
  });
  it('customer texts are a fallback: skipped once a push got through', () => {
    assert.equal(sendOffApp({ channels: ['SMS'], whenNoPush: true }, { phone }, false), true);
    assert.equal(sendOffApp({ channels: ['SMS'], whenNoPush: true }, { phone }, true), false);
  });
  it('without whenNoPush the text goes regardless of push', () => {
    assert.equal(sendOffApp({ channels: ['SMS', 'WHATSAPP'] }, { phone }, true), true);
  });
});
