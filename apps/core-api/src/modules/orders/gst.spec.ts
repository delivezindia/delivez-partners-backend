import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gstBill, isGstin, splitGst } from './gst';

describe('GST on a bill', () => {
  it('works tax back out of a GST-inclusive price', () => {
    assert.deepEqual(splitGst(10500, 5), { taxable: 10000, cgst: 250, sgst: 250 });
    assert.deepEqual(splitGst(11800, 18), { taxable: 10000, cgst: 900, sgst: 900 });
    assert.deepEqual(splitGst(5000, 0), { taxable: 5000, cgst: 0, sgst: 0 });
  });

  it('never loses a paisa to rounding', () => {
    for (const total of [1, 99, 101, 12345, 99999]) for (const rate of [5, 12, 18, 28]) {
      const s = splitGst(total, rate);
      assert.equal(s.taxable + s.cgst + s.sgst, total, `${total} @ ${rate}%`);
      assert.ok(Math.abs(s.cgst - s.sgst) <= 1);
    }
  });

  it('groups by rate and taxes packaging with the main supply', () => {
    const b = gstBill([{ name: 'Biryani', hsn: '9963', qty: 1, ratePct: 5, total: 21000 }, { name: 'Coke', hsn: '2202', qty: 1, ratePct: 18, total: 4000 }], 1000, true);
    assert.equal(b.rows.length, 3);
    assert.equal(b.rows[2].name, 'Packaging charges');
    assert.equal(b.rows[2].ratePct, 18);
    assert.deepEqual(b.byRate.map((r) => r.ratePct), [5, 18]);
    assert.equal(b.total, 26000);
    assert.equal(b.taxable + b.cgst + b.sgst, b.total);
  });

  it('a shop without GSTIN shows no tax', () => {
    const b = gstBill([{ name: 'Rice 5 kg', hsn: null, qty: 1, ratePct: 5, total: 40000 }], 0, false);
    assert.equal(b.cgst + b.sgst, 0);
    assert.equal(b.taxable, 40000);
    assert.deepEqual(b.byRate.map((r) => r.ratePct), [0]);
  });

  it('checks GSTIN shape', () => {
    assert.equal(isGstin('29ABCDE1234F1Z5'), true);
    assert.equal(isGstin('29abcde1234f1z5'), true);
    assert.equal(isGstin('29ABCDE1234F1X5'), false);
    assert.equal(isGstin(''), false);
  });
});
