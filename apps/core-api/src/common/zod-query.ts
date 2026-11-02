import { Query } from '@nestjs/common';
import { ApiQuery, type ApiQueryOptions } from '@nestjs/swagger';
import { z, type ZodTypeAny } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/** Strips optional / default / nullable / refine wrappers down to the type that describes the value. */
function unwrap(t: ZodTypeAny): ZodTypeAny {
  if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) return unwrap(t.unwrap());
  if (t instanceof z.ZodDefault) return unwrap(t._def.innerType);
  if (t instanceof z.ZodEffects) return unwrap(t.innerType());
  return t;
}

/** Swagger descriptions for the fields of a query schema (z.object, possibly refined). */
export function describeQuery(schema: ZodTypeAny): (ApiQueryOptions & { name: string })[] {
  const obj = unwrap(schema);
  if (!(obj instanceof z.ZodObject)) return [];
  return Object.entries(obj.shape as Record<string, ZodTypeAny>).map(([name, field]) => {
    const base = unwrap(field);
    const fallback = field instanceof z.ZodDefault ? field._def.defaultValue() : undefined;
    const opts: ApiQueryOptions & { name: string } = { name, required: !field.isOptional(), description: field.description, ...(fallback !== undefined ? { example: fallback } : {}) };
    if (base instanceof z.ZodEnum) return { ...opts, enum: base.options as string[] };
    if (base instanceof z.ZodNativeEnum) return { ...opts, enum: Object.values(base.enum as Record<string, string>) };
    if (base instanceof z.ZodNumber) return { ...opts, type: Number };
    if (base instanceof z.ZodBoolean) return { ...opts, type: Boolean };
    if (base instanceof z.ZodArray) return { ...opts, type: [String] };
    return { ...opts, type: String };
  });
}

// @ZodQuery(schema) q: z.infer<typeof schema> — validates the query string like @Query(new ZodValidationPipe(schema))
// and lists its fields in the API docs (Swagger can't see inside a zod schema on its own).
export function ZodQuery(schema: ZodTypeAny): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
    const descriptor = key !== undefined ? Object.getOwnPropertyDescriptor(target, key) : undefined;
    if (key !== undefined && descriptor) for (const q of describeQuery(schema)) ApiQuery(q)(target, key, descriptor);
  };
}
