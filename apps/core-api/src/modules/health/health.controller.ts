import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { BUILD } from '../../common/version';
import { Public } from '../identity/auth.decorators';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    // stale: new code was pulled but not built, so the old code is still answering.
    return { status: db === 'up' ? 'ok' : 'degraded', db, version: BUILD.version, commit: BUILD.commit, stale: BUILD.stale, time: new Date().toISOString() };
  }
}
