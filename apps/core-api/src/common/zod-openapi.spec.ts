import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { zodToJsonSchema } from './zod-openapi';

describe('zod schemas in the API docs', () => {
  it('describes objects with required and optional fields, limits and formats', () => {
    const s = zodToJsonSchema(
      z.object({
        name: z.string().trim().min(2).max(80),
        email: z.string().email().optional(),
        qty: z.number().int().min(1).max(99).default(1),
        kind: z.enum(['A', 'B']),
        tags: z.array(z.string()).min(1),
        note: z.string().nullable(),
        agree: z.literal(true),
      }),
    );
    assert.deepEqual(s.required, ['name', 'kind', 'tags', 'note', 'agree']);
    const p = s.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(p.name, { type: 'string', minLength: 2, maxLength: 80 });
    assert.equal(p.email.format, 'email');
    assert.deepEqual(p.qty, { type: 'integer', minimum: 1, maximum: 99, default: 1 });
    assert.deepEqual(p.kind, { type: 'string', enum: ['A', 'B'] });
    assert.equal(p.tags.minItems, 1);
    assert.equal(p.note.nullable, true);
    assert.deepEqual(p.agree, { type: 'boolean', enum: [true] });
  });

  it('looks through refine / transform / preprocess to what the client sends', () => {
    const s = zodToJsonSchema(z.object({ plate: z.string().transform((v) => v.toUpperCase()) }).refine(() => true));
    assert.deepEqual((s.properties as Record<string, unknown>).plate, { type: 'string' });
    assert.deepEqual(zodToJsonSchema(z.preprocess(Number, z.number().positive())), { type: 'number', minimum: 0, exclusiveMinimum: true });
  });

  it('handles unions, records and unknown values', () => {
    assert.equal((zodToJsonSchema(z.union([z.string(), z.number()])).oneOf as unknown[]).length, 2);
    assert.deepEqual(zodToJsonSchema(z.record(z.boolean())), { type: 'object', additionalProperties: { type: 'boolean' } });
    assert.deepEqual(zodToJsonSchema(z.unknown()), {});
  });
});
