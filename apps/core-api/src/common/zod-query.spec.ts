import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { describeQuery } from './zod-query';

describe('describeQuery', () => {
  it('lists each field with its type, whether it is required, and the default', () => {
    const schema = z.object({
      status: z.enum(['open', 'resolved']).default('open'),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      q: z.string().trim().optional(),
      storeId: z.string().uuid(),
    });
    const byName = Object.fromEntries(describeQuery(schema).map((d) => [d.name, d as typeof d & { type?: unknown }]));
    assert.deepEqual(byName.status, { name: 'status', required: false, description: undefined, example: 'open', enum: ['open', 'resolved'] });
    assert.equal(byName.limit.type, Number);
    assert.equal(byName.limit.example, 100);
    assert.equal(byName.q.required, false);
    assert.equal(byName.q.type, String);
    assert.equal(byName.storeId.required, true);
  });

  it('sees through .refine()', () => {
    const schema = z.object({ from: z.string(), to: z.string() }).refine((v) => v.from <= v.to);
    assert.deepEqual(describeQuery(schema).map((d) => d.name), ['from', 'to']);
  });
});
