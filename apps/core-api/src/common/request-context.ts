import type { Request } from 'express';
import type { AppId } from '@delivez/db';

export interface AuthUser {
  userId: string;
  app: AppId;
  sessionId: string;
}

export type ApiRequest = Request & {
  correlationId: string;
  user?: AuthUser;
};
