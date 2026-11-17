import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { z, type ZodTypeAny } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

type JsonSchema = Record<string, unknown>;

/** What a client may send for a zod schema, as OpenAPI 3.0 JSON Schema (input side: before transforms and defaults). */
export function zodToJsonSchema(t: ZodTypeAny): JsonSchema {
  const out = convert(t);
  if (t.description && !out.description) out.description = t.description;
  return out;
}

function convert(t: ZodTypeAny): JsonSchema {
  if (t instanceof z.ZodOptional) return zodToJsonSchema(t.unwrap());
  if (t instanceof z.ZodNullable) return { ...zodToJsonSchema(t.unwrap()), nullable: true };
  if (t instanceof z.ZodDefault) return { ...zodToJsonSchema(t._def.innerType), default: safeDefault(t) };
  if (t instanceof z.ZodCatch) return zodToJsonSchema(t._def.innerType);
  if (t instanceof z.ZodEffects) return zodToJsonSchema(t._def.schema);
  if (t instanceof z.ZodPipeline) return zodToJsonSchema(t._def.in);
  if (t instanceof z.ZodBranded) return zodToJsonSchema(t._def.type);
  if (t instanceof z.ZodReadonly) return zodToJsonSchema(t._def.innerType);
  if (t instanceof z.ZodLazy) return {};

  if (t instanceof z.ZodString) {
    const s: JsonSchema = { type: 'string' };
    for (const c of t._def.checks) {
      if (c.kind === 'min') s.minLength = c.value;
      else if (c.kind === 'max') s.maxLength = c.value;
      else if (c.kind === 'length') s.minLength = s.maxLength = c.value;
      else if (c.kind === 'email') s.format = 'email';
      else if (c.kind === 'uuid') s.format = 'uuid';
      else if (c.kind === 'url') s.format = 'uri';
      else if (c.kind === 'datetime') s.format = 'date-time';
      else if (c.kind === 'date') s.format = 'date';
      else if (c.kind === 'regex') s.pattern = c.regex.source;
    }
    return s;
  }
  if (t instanceof z.ZodNumber) {
    const s: JsonSchema = { type: 'number' };
    for (const c of t._def.checks) {
      if (c.kind === 'int') s.type = 'integer';
      else if (c.kind === 'min') s[c.inclusive ? 'minimum' : 'exclusiveMinimum'] = c.value;
      else if (c.kind === 'max') s[c.inclusive ? 'maximum' : 'exclusiveMaximum'] = c.value;
      else if (c.kind === 'multipleOf') s.multipleOf = c.value;
    }
    // OpenAPI 3.0 wants exclusive bounds as booleans next to minimum / maximum.
    if (typeof s.exclusiveMinimum === 'number') { s.minimum = s.exclusiveMinimum; s.exclusiveMinimum = true; }
    if (typeof s.exclusiveMaximum === 'number') { s.maximum = s.exclusiveMaximum; s.exclusiveMaximum = true; }
    return s;
  }
  if (t instanceof z.ZodBigInt) return { type: 'integer', format: 'int64' };
  if (t instanceof z.ZodBoolean) return { type: 'boolean' };
  if (t instanceof z.ZodDate) return { type: 'string', format: 'date-time' };
  if (t instanceof z.ZodNull) return { nullable: true };
  if (t instanceof z.ZodEnum) return { type: 'string', enum: [...(t.options as string[])] };
  if (t instanceof z.ZodNativeEnum) {
    const values = Object.values(t.enum as Record<string, string | number>).filter((v, _, all) => typeof v === 'string' || !all.includes(String(v)));
    return { type: typeof values[0] === 'number' ? 'number' : 'string', enum: values };
  }
  if (t instanceof z.ZodLiteral) {
    const v = t.value as unknown;
    return v === null ? { nullable: true } : { type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string', enum: [v] };
  }
  if (t instanceof z.ZodArray) {
    const s: JsonSchema = { type: 'array', items: zodToJsonSchema(t.element) };
    if (t._def.minLength) s.minItems = t._def.minLength.value;
    if (t._def.maxLength) s.maxItems = t._def.maxLength.value;
    if (t._def.exactLength) s.minItems = s.maxItems = t._def.exactLength.value;
    return s;
  }
  if (t instanceof z.ZodTuple) return { type: 'array', items: { oneOf: (t.items as ZodTypeAny[]).map(zodToJsonSchema) }, minItems: t.items.length, maxItems: t.items.length };
  if (t instanceof z.ZodSet) return { type: 'array', uniqueItems: true, items: zodToJsonSchema(t._def.valueType) };
  if (t instanceof z.ZodObject) {
    const shape = t.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(field);
      if (!field.isOptional()) required.push(key);
    }
    const s: JsonSchema = { type: 'object', properties };
    if (required.length) s.required = required;
    const extra = t._def.catchall as ZodTypeAny;
    if (!(extra instanceof z.ZodNever)) s.additionalProperties = zodToJsonSchema(extra);
    return s;
  }
  if (t instanceof z.ZodRecord) return { type: 'object', additionalProperties: zodToJsonSchema(t.valueSchema) };
  if (t instanceof z.ZodMap) return { type: 'object', additionalProperties: zodToJsonSchema(t._def.valueType) };
  if (t instanceof z.ZodUnion || t instanceof z.ZodDiscriminatedUnion) {
    return { oneOf: [...(t.options as ZodTypeAny[])].map(zodToJsonSchema) };
  }
  if (t instanceof z.ZodIntersection) return { allOf: [zodToJsonSchema(t._def.left), zodToJsonSchema(t._def.right)] };
  return {}; // any / unknown
}

function safeDefault(t: z.ZodDefault<ZodTypeAny>): unknown {
  try {
    const v = t._def.defaultValue();
    return v instanceof Date ? v.toISOString() : v;
  } catch {
    return undefined;
  }
}

/** The zod schema a route validates its body with (`@Body(new ZodValidationPipe(schema))`), if any. */
function bodySchemaOf(controller: Function, method: string): ZodTypeAny | undefined {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<string, { pipes?: unknown[]; data?: unknown }>;
  for (const [key, arg] of Object.entries(args)) {
    if (Number(key.split(':')[0]) !== RouteParamtypes.BODY || arg.data !== undefined) continue;
    const pipe = arg.pipes?.find((p): p is ZodValidationPipe<unknown> => p instanceof ZodValidationPipe);
    if (pipe) return pipe.schema as ZodTypeAny;
  }
  return undefined;
}

// Metadata keys set by @Public / @Apps / @AdminRoles / @PartnerRoles / @RequireIdempotency.
const META = { public: 'isPublic', apps: 'allowedApps', adminRoles: 'adminRoles', partnerRoles: 'partnerRoles', idempotency: 'requireIdempotency' };

/** Method-level metadata wins over the controller's, like the guards read it. */
function meta<T>(key: string, ctrl: Function, handler: Function): T | undefined {
  return (Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, ctrl)) as T | undefined;
}

interface RouteInfo {
  body?: ZodTypeAny;
  isPublic: boolean;
  apps?: string[];
  adminRoles?: string[];
  partnerRoles?: string[];
  idempotency: boolean;
  method: string;
}

function accessLine(r: RouteInfo): string {
  if (r.isPublic) return '**Access:** public, no login.';
  const parts = [r.apps?.length ? `Bearer token from the ${r.apps.join(' / ')} app` : 'Bearer token from any app'];
  if (r.adminRoles?.length) parts.push(`admin roles: ${r.adminRoles.join(', ')}`);
  else if (r.apps?.includes('ADMIN')) parts.push('any admin role');
  if (r.partnerRoles?.length) parts.push(`store roles: ${r.partnerRoles.join(', ')}`);
  return `**Access:** ${parts.join(' · ')}.`;
}

/** saveStep → "Save step" */
function humanize(method: string): string {
  const words = method.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Operation = { operationId?: string; summary?: string; description?: string; requestBody?: unknown; security?: unknown[]; parameters?: { in: string; name: string }[] };

/**
 * Make the generated Swagger complete for this codebase:
 * - request bodies from the zod schemas (Swagger can't look inside zod; explicit @ApiBody is left alone),
 * - who may call each route (public / which app's token / which roles), from the same decorators the guards read,
 * - a short summary where the route has no doc comment, and the Idempotency-Key header where it is required.
 * Routes are matched by Nest's default operationId, Controller_method.
 */
export function enrichApiDocs(app: INestApplication, document: OpenAPIObject): void {
  const routes = new Map<string, RouteInfo>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as Function | undefined;
      if (!ctrl?.prototype) continue;
      for (const method of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[method] as unknown;
        if (method === 'constructor' || typeof handler !== 'function') continue;
        routes.set(`${ctrl.name}_${method}`, {
          body: bodySchemaOf(ctrl, method),
          isPublic: !!meta<boolean>(META.public, ctrl, handler),
          apps: meta<string[]>(META.apps, ctrl, handler),
          adminRoles: meta<string[]>(META.adminRoles, ctrl, handler),
          partnerRoles: meta<string[]>(META.partnerRoles, ctrl, handler),
          idempotency: !!meta<boolean>(META.idempotency, ctrl, handler),
          method,
        });
      }
    }
  }
  for (const item of Object.values(document.paths)) {
    for (const op of Object.values(item) as Operation[]) {
      if (!op || typeof op !== 'object' || !op.operationId) continue;
      const r = routes.get(op.operationId);
      if (!r) continue;
      if (r.body && !op.requestBody) op.requestBody = { required: !r.body.isOptional(), content: { 'application/json': { schema: zodToJsonSchema(r.body) } } };
      if (!op.summary) op.summary = humanize(r.method);
      op.description = [accessLine(r), op.description].filter(Boolean).join('\n\n');
      op.security = r.isPublic ? [] : [{ bearer: [] }];
      if (r.idempotency && !op.parameters?.some((p) => p.in === 'header' && p.name === 'Idempotency-Key')) {
        (op.parameters ??= []).push({ in: 'header', name: 'Idempotency-Key', required: true, description: 'A new random id per action (e.g. a UUID); a retry with the same id returns the first result instead of repeating it.', schema: { type: 'string', maxLength: 100 } } as never);
      }
    }
  }
}
