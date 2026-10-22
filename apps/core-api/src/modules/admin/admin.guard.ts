import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import type { ApiRequest } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminContext {
  adminId: string;
  userId: string;
  role: AdminRole;
  /** Empty = all cities. */
  cityIds: string[];
}

const ADMIN_ROLES = 'adminRoles';

/** Restricts an admin route to these roles (plan §4.2). Without it, any active admin may read. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES, roles);

// Role groups used across the admin console (plan §4.2 role model).
export const ROLES = {
  READ: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'SUPPORT', 'AUDITOR'] as AdminRole[],
  VERIFY_DOCUMENTS: ['FOUNDER', 'HEAD_OF_OPS', 'COMPLIANCE'] as AdminRole[],
  APPROVE_STORES: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'COMPLIANCE'] as AdminRole[],
  SUSPEND_STORES: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'COMPLIANCE'] as AdminRole[],
  REINSTATE_STORES: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD'] as AdminRole[],
  /** Day-to-day store control: pause/resume new orders, send notices. */
  OPERATE_STORES: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS'] as AdminRole[],
  /** Turning a partner's staff login on/off (lost phone, ex-employee). */
  MANAGE_PARTNER_USERS: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'SUPPORT'] as AdminRole[],
  MANAGE_TEAM: ['FOUNDER', 'HEAD_OF_OPS'] as AdminRole[],
  MANAGE_GEO: ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD'] as AdminRole[],
  MANAGE_LEGAL: ['FOUNDER', 'LEGAL'] as AdminRole[],
  VIEW_AUDIT: ['FOUNDER', 'HEAD_OF_OPS', 'COMPLIANCE', 'LEGAL', 'AUDITOR'] as AdminRole[],
};
/** Roles only a FOUNDER may grant. */
export const SENIOR_ROLES: AdminRole[] = ['FOUNDER', 'HEAD_OF_OPS'];

type AdminRequest = ApiRequest & { admin?: AdminContext };

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  return ctx.switchToHttp().getRequest<AdminRequest>().admin!;
});

/** Loads the caller's admin_users row and checks the role list. City scope is checked per store in the service. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (!req.user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Please log in');
    const admin = await this.prisma.adminUser.findUnique({ where: { userId: req.user.userId } });
    if (!admin?.isActive) throw new ApiError(HttpStatus.FORBIDDEN, 'NOT_AN_ADMIN', 'This account has no admin access');

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES, [context.getHandler(), context.getClass()]) ?? ROLES.READ;
    if (!roles.includes(admin.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', `Your role (${admin.role}) cannot do this`);
    }
    req.admin = { adminId: admin.id, userId: admin.userId, role: admin.role, cityIds: admin.cityIds };
    return true;
  }
}
