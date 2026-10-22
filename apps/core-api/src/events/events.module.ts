import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus.service';
import { AuditService } from './audit.service';

@Global()
@Module({ providers: [EventBus, AuditService], exports: [EventBus, AuditService] })
export class EventsModule {}
