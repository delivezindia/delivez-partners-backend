import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { everyRow, type Page } from './every-row';

/** A fake table answering Prisma-style cursor pages. */
const table = (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, '0') }));
  const calls: Page[] = [];
  const page = async (p: Page) => {
    calls.push(p);
    const start = p.cursor ? rows.findIndex((r) => r.id === p.cursor!.id) + (p.skip ?? 0) : 0;
    return rows.slice(start, start + p.take);
  };
  return { page, calls };
};

describe('everyRow', () => {
  it('returns every row across batches, none twice', async () => {
    const t = table(1203);
    const rows = await everyRow(t.page, 500);
    assert.equal(rows.length, 1203);
    assert.equal(new Set(rows.map((r) => r.id)).size, 1203);
    assert.equal(t.calls.length, 3);
  });

  it('stops after one call when everything fits', async () => {
    const t = table(42);
    assert.equal((await everyRow(t.page, 500)).length, 42);
    assert.equal(t.calls.length, 1);
  });

  it('makes one extra empty call when the last batch is exactly full', async () => {
    const t = table(1000);
    assert.equal((await everyRow(t.page, 500)).length, 1000);
    assert.equal(t.calls.length, 3);
  });
});
