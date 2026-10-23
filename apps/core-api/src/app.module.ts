import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { resolve } from 'node:path';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { KvModule } from './common/kv/kv.module';
import { EventsModule } from './events/events.module';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { I18nModule } from './modules/i18n/i18n.module';
import { OrdersModule } from './modules/orders/orders.module';
import { LabBookingsModule } from './modules/lab-bookings/lab-bookings.module';
import { PartnersModule } from './modules/partners/partners.module';
import { FilesModule } from './modules/files/files.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { AdminModule } from './modules/admin/admin.module';
import { StoresModule } from './modules/stores/stores.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    // Root .env is shared with packages/db (Prisma CLI). dist/ and src/ are both 3 levels below the repo root.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: [resolve(__dirname, '../../../.env')] }),
    PrismaModule,
    KvModule,
    EventsModule,
    MessagingModule,
    IdentityModule,
    I18nModule,
    HealthModule,
    GeoModule,
    FilesModule,
    PartnersModule,
    OnboardingModule,
    AdminModule,
    OrdersModule,
    LabBookingsModule,
    StoresModule,
    CatalogModule,
    NotificationsModule,
    SystemModule,
    RealtimeModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
