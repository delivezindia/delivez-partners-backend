import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { from, Observable, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { ApiError } from './api-exception.filter';
import { KvService } from './kv/kv.service';
import type { ApiRequest } from './request-context';

const REQUIRE_IDEMPOTENCY = 'requireIdempotency';
/** Marks a route whose POST must carry an Idempotency-Key header (plan §13.1). */
export const RequireIdempotency = () => SetMetadata(REQUIRE_IDEMPOTENCY, true);

const TTL_SECONDS = 24 * 60 * 60;

// Replays the stored response for a repeated Idempotency-Key instead of running the handler twice.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly kv: KvService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next.handle();

    const key = req.header('idempotency-key');
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) {
      if (required) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
      }
      return next.handle();
    }
    if (key.length > 128) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key is too long');
    }

    const scope = req.user?.userId ?? 'anon';
    const storeKey = `idem:${scope}:${req.method}:${req.path}:${key}`;

    return from(this.kv.get(storeKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          const saved = JSON.parse(cached) as { state: string; status?: number; body?: unknown };
          if (saved.state === 'IN_PROGRESS') {
            throw new ApiError(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed');
          }
          res.setHeader('idempotent-replay', 'true');
          res.status(saved.status ?? 200);
          return of(saved.body);
        }
        return from(this.kv.setIfAbsent(storeKey, JSON.stringify({ state: 'IN_PROGRESS' }), 60)).pipe(
          switchMap((acquired) => {
            if (!acquired) {
              throw new ApiError(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS', 'The same request is still being processed');
            }
            return next.handle().pipe(
              tap((body) => {
                void this.kv.set(storeKey, JSON.stringify({ state: 'DONE', status: res.statusCode, body }), TTL_SECONDS);
              }),
              // Failed attempts may be retried with the same key.
              catchError((err) => from(this.kv.del(storeKey)).pipe(switchMap(() => throwError(() => err)))),
            );
          }),
        );
      }),
    );
  }
}
