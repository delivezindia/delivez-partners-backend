import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { render } from './templates';

describe('STORE_STATUS copy', () => {
  it('a resume tells the shop to tap Open (the store stays closed until it does)', () => {
    for (const lang of ['EN', 'HI', 'KN']) {
      const { title, body } = render('STORE_STATUS', lang, { store: "Ravi's Kitchen", to: 'LIVE', action: 'RESUME' });
      assert.match(title, /Ravi's Kitchen/);
      assert.match(body, /Open|खुला|ತೆರೆದಿದೆ/);
    }
    assert.equal(render('STORE_STATUS', 'EN', { store: 'S', to: 'LIVE', action: 'RESUME' }).title, 'Orders resumed for S');
  });
  it('other changes keep the status line and the reason', () => {
    const paused = render('STORE_STATUS', 'EN', { store: 'S', to: 'PAUSED', reason: 'Hygiene check', action: 'PAUSE' });
    assert.equal(paused.title, 'S is paused by Delivez');
    assert.equal(paused.body, 'Hygiene check');
    assert.equal(render('STORE_STATUS', 'EN', { store: 'S', to: 'LIVE', action: 'APPROVE_LIVE' }).title, 'S is approved and live');
  });
});
