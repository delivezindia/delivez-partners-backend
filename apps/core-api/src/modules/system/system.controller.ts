import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { KvService } from '../../common/kv/kv.service';
import { BUILD } from '../../common/version';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminGuard, AdminRoles, ROLES } from '../admin/admin.guard';
import { Apps } from '../identity/auth.decorators';
import { showOtpInResponse } from '../identity/otp-visibility';
import { MessagingService } from '../messaging/messaging.service';
import { PushSender } from '../notifications/push-sender';
import { webPushConfig } from '../notifications/web-push-config';

type Check = { level: 'ok' | 'warn' | 'error'; area: string; message: string };
const SMS_TEMPLATES = ['OTP', 'ORDER_REMINDER', 'ORDER_MISSED', 'STORE_STATUS', 'STAFF_ADDED'];
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Admin → System: is everything set up on this server? Reports only on/off states and names — never secret values.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvService,
    private readonly push: PushSender,
    private readonly messaging: MessagingService,
  ) {}

  @Get('status')
  @AdminRoles(...ROLES.MANAGE_TEAM)
  async status() {
    const prod = process.env.NODE_ENV === 'production';
    const since = new Date(Date.now() - 24 * 3600_000);

    const t0 = Date.now();
    const dbOk = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const dbMs = Date.now() - t0;
    const redisOk = await this.kv.ping();

    const pushSender = this.push.describe();
    const web = webPushConfig();
    const [devices, pushSent, pushFailed] = dbOk
      ? await Promise.all([
          this.prisma.deviceToken.count({ where: { isActive: true } }),
          this.prisma.notification.count({ where: { status: 'SENT', sentAt: { gte: since } } }),
          this.prisma.notification.count({ where: { status: 'FAILED', createdAt: { gte: since } } }),
        ])
      : [0, 0, 0];

    const smsProvider = this.messaging.providerFor('SMS');
    const templates = SMS_TEMPLATES.map((code) => ({ code, set: !!process.env[`MSG91_TEMPLATE_${code}`] }));
    const msgs = dbOk ? await this.prisma.messageLog.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }) : [];
    const codesOnScreen = showOtpInResponse();

    const uploadDir = resolve(process.env.UPLOAD_DIR || resolve(__dirname, '../../../uploads'));
    const uploadsWritable = await mkdir(uploadDir, { recursive: true })
      .then(() => access(uploadDir, constants.W_OK))
      .then(() => true)
      .catch(() => false);

    const cors = list(process.env.CORS_ORIGINS);
    const checks: Check[] = [];
    const add = (level: Check['level'], area: string, message: string) => checks.push({ level, area, message });

    add(dbOk ? 'ok' : 'error', 'Database', dbOk ? `Connected (${dbMs} ms)` : 'Cannot reach PostgreSQL — check DATABASE_URL and that the database is running');
    if (this.kv.mode === 'memory') add(prod ? 'warn' : 'ok', 'Redis', 'Not configured (REDIS_URL empty) — login limits reset when the API restarts');
    else add(redisOk ? 'ok' : 'error', 'Redis', redisOk ? 'Connected' : 'REDIS_URL is set but Redis does not answer');
    if (pushSender.mode === 'firebase') add('ok', 'Push', `Sending via Firebase project ${pushSender.projectId}`);
    else add(prod ? 'error' : 'warn', 'Push', pushSender.problem ?? 'Not sending');
    if (!web.webReady) add('error', 'Push', `Browsers cannot turn on alerts — missing in .env: ${web.missing.join(', ')}`);
    if (smsProvider === 'DEV') add(prod ? 'warn' : 'ok', 'SMS', 'Not connected (SMS_PROVIDER=DEV) — no real SMS is sent');
    else {
      const unset = templates.filter((t) => !t.set).map((t) => t.code);
      add(unset.length ? 'warn' : 'ok', 'SMS', unset.length ? `MSG91 connected; templates missing for ${unset.join(', ')}` : 'MSG91 connected with all templates');
    }
    if (prod && codesOnScreen) add('warn', 'Login', 'TEST MODE: login codes are shown on screen — anyone can sign in as any number. Switch off before real partners (or connect MSG91).');
    add(uploadsWritable ? 'ok' : 'error', 'Uploads', uploadsWritable ? `Writable: ${uploadDir}` : `Cannot write to ${uploadDir} — create it and give the API user access`);
    if (prod && !process.env.PUBLIC_API_URL) add('warn', 'Addresses', 'PUBLIC_API_URL is empty — file and photo links only work when the web apps share the API domain');
    if (prod && !cors.length) add('warn', 'Addresses', 'CORS_ORIGINS is empty — browsers on other domains cannot call the API');

    return {
      overall: checks.some((c) => c.level === 'error') ? 'error' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok',
      checks,
      build: { ...BUILD, node: process.version, environment: process.env.NODE_ENV ?? 'development', uptimeSeconds: Math.round(process.uptime()) },
      database: { ok: dbOk, latencyMs: dbMs },
      redis: { mode: this.kv.mode, ok: redisOk },
      push: { sender: pushSender, webReady: web.webReady, missingWebSettings: web.missing, activeDevices: devices, last24h: { sent: pushSent, failed: pushFailed } },
      sms: { provider: smsProvider, whatsapp: this.messaging.providerFor('WHATSAPP'), templates, last24h: Object.fromEntries(msgs.map((m) => [m.status, m._count._all])) },
      login: { codesShownOnScreen: codesOnScreen },
      addresses: { publicApiUrl: process.env.PUBLIC_API_URL || null, corsOrigins: cors, partnersWebUrl: process.env.PARTNERS_WEB_URL || null },
      uploads: { dir: uploadDir, writable: uploadsWritable },
    };
  }

  /** Asks Google for an access token with the Firebase key: proves key, server clock and network — sends no message. */
  @Post('push-check')
  @HttpCode(200)
  @AdminRoles(...ROLES.MANAGE_TEAM)
  async pushCheck() {
    const started = Date.now();
    const r = await this.push.verify();
    return { ...r, ms: Date.now() - started, checkedAt: new Date().toISOString() };
  }
}
