import { Global, Module } from '@nestjs/common';
import { KvService } from './kv.service';

@Global()
@Module({ providers: [KvService], exports: [KvService] })
export class KvModule {}
