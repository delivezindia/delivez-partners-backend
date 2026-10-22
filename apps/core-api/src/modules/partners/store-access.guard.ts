import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PartnerRole } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import type { ApiRequest } from '../../common/request-context';
import { PartnerAccessService, type StoreAccess } from './partner-access.service';

const PARTNER_ROLES = 'partnerRoles';

/**
 * Restricts a `:storeId` route to members with one of these roles (plan §4.2).
 * With no roles listed, any active member of the store may call it.
 */
export const PartnerRoles = (...roles: PartnerRole[]) => SetMetadata(PARTNER_ROLES, roles);

type StoreRequest = ApiRequest & { storeAccess?: StoreAccess };

export const CurrentStore = createParamDecorator((_: unknown, ctx: ExecutionContext): StoreAccess => {
  return ctx.switchToHttp().getRequest<StoreRequest>().storeAccess!;
});

@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: PartnerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StoreRequest>();
    const storeId = req.params.storeId;
    if (typeof storeId !== 'string' || !storeId) return true;

    const access = req.user ? await this.access.forStore(req.user.userId, storeId) : null;
    if (!access) throw new ApiError(HttpStatus.FORBIDDEN, 'STORE_ACCESS_DENIED', 'You do not have access to this store');

    const roles = this.reflector.getAllAndOverride<PartnerRole[] | undefined>(PARTNER_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.includes(access.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', `Your role (${access.role}) cannot do this`);
    }
    req.storeAccess = access;
    return true;
  }
}
