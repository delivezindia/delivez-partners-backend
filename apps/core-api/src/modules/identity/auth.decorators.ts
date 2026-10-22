import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppId } from '@delivez/db';
import type { ApiRequest, AuthUser } from '../../common/request-context';

export const IS_PUBLIC = 'isPublic';
export const ALLOWED_APPS = 'allowedApps';

/** Skips authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route/controller to tokens issued for these apps (JWT `app` claim). */
export const Apps = (...apps: AppId[]) => SetMetadata(ALLOWED_APPS, apps);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<ApiRequest>().user!;
});
