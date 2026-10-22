import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppId } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { KvService } from '../../common/kv/kv.service';
import type { ApiRequest } from '../../common/request-context';
import { ALLOWED_APPS, IS_PUBLIC } from './auth.decorators';
import { TokenService } from './token.service';

export const revokedSessionKey = (sessionId: string) => `session:revoked:${sessionId}`;

// Global guard: every route needs a valid access token unless marked @Public().
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly kv: KvService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new ApiError(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Please log in');

    let claims;
    try {
      claims = this.tokens.verifyAccess(token);
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_INVALID', 'Session expired. Please log in again.');
    }
    if (await this.kv.get(revokedSessionKey(claims.sid))) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED', 'You have been logged out');
    }

    const allowed = this.reflector.getAllAndOverride<AppId[] | undefined>(ALLOWED_APPS, targets);
    if (allowed && !allowed.includes(claims.app)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'WRONG_APP', 'This token cannot be used for this app');
    }

    req.user = { userId: claims.sub, app: claims.app, sessionId: claims.sid };
    return true;
  }
}
