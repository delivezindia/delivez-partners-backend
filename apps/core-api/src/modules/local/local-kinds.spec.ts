import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countsAs, kindWhere } from './local-kinds';

describe('kindWhere', () => {
  it('asks for every kind of shop when none is given', () => {
    assert.deepEqual(kindWhere(), {});
  });

  it('leaves street and society vendors out of Local stores', () => {
    assert.deepEqual(kindWhere('LOCAL_STORES'), { vertical: 'LOCAL_STORES', storeType: { notIn: ['STREET_VENDOR', 'SOCIETY_VENDOR'] } });
  });

  it('filters other kinds by kind only', () => {
    assert.deepEqual(kindWhere('EAT'), { vertical: 'EAT' });
  });
});

describe('countsAs', () => {
  it('counts a street cart under neither Local stores nor another kind', () => {
    assert.equal(countsAs({ vertical: 'LOCAL_STORES', storeType: 'STREET_VENDOR' }, 'LOCAL_STORES'), false);
    assert.equal(countsAs({ vertical: 'LOCAL_STORES', storeType: 'SOCIETY_VENDOR' }, 'LOCAL_STORES'), false);
  });

  it('counts other local shops under Local stores', () => {
    assert.equal(countsAs({ vertical: 'LOCAL_STORES', storeType: 'BAKERY' }, 'LOCAL_STORES'), true);
  });

  it('counts a shop under its own kind only', () => {
    assert.equal(countsAs({ vertical: 'EAT', storeType: 'RESTAURANT' }, 'EAT'), true);
    assert.equal(countsAs({ vertical: 'EAT', storeType: 'RESTAURANT' }, 'GROCERY'), false);
  });
});
