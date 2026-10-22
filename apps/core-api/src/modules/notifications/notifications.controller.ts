import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Public } from '../identity/auth.decorators';
import { PushSender } from './push-sender';
import { NotificationsService } from './notifications.service';

const listQuery = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
const deviceSchema = z.object({ token: z.string().min(20).max(4096), platform: z.enum(['WEB', 'ANDROID', 'IOS']) });
const removeSchema = z.object({ token: z.string().min(20).max(4096) });

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushSender,
  ) {}

  /** Public Firebase web config (these values are meant to be public) so browsers can register for push. */
  @Public()
  @Get('push/config')
  config() {
    const web = {
      apiKey: process.env.FIREBASE_WEB_API_KEY,
      projectId: process.env.FIREBASE_PROJECT_ID,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_WEB_APP_ID,
    };
    const vapidKey = process.env.FIREBASE_VAPID_KEY ?? null;
    const webReady = !!(web.apiKey && web.projectId && web.messagingSenderId && web.appId && vapidKey);
    return { webReady, sending: this.push.enabled, web: webReady ? { ...web, authDomain: `${web.projectId}.firebaseapp.com` } : null, vapidKey: webReady ? vapidKey : null };
  }

  @ApiBearerAuth()
  @Get('me/notifications')
  list(@CurrentUser() u: AuthUser, @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.notifications.list(u.userId, u.app, q.before, q.limit);
  }

  @ApiBearerAuth()
  @Get('me/notifications/unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { unread: await this.notifications.unread(u.userId, u.app) };
  }

  @ApiBearerAuth()
  @Post('me/notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) {
    return this.notifications.markRead(u.userId, u.app);
  }

  @ApiBearerAuth()
  @Post('me/notifications/test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser) {
    return this.notifications.test(u.userId, u.app);
  }

  @ApiBearerAuth()
  @Post('me/notifications/:id/read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(u.userId, u.app, id);
  }

  @ApiBearerAuth()
  @Post('me/push-tokens')
  @HttpCode(200)
  register(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(deviceSchema)) b: z.infer<typeof deviceSchema>) {
    return this.notifications.registerDevice(u.userId, u.app, b.token, b.platform);
  }

  @ApiBearerAuth()
  @Delete('me/push-tokens')
  remove(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(removeSchema)) b: z.infer<typeof removeSchema>) {
    return this.notifications.removeDevice(u.userId, b.token);
  }
}
