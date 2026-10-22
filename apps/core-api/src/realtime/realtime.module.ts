import { Module } from '@nestjs/common';
import { PartnersModule } from '../modules/partners/partners.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({ imports: [PartnersModule], providers: [RealtimeGateway] })
export class RealtimeModule {}
