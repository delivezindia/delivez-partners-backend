import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ZodQuery } from '../../common/zod-query';
import { Public } from '../identity/auth.decorators';
import { GeoService } from './geo.service';

const searchSchema = z.object({ q: z.string().trim().min(3).max(200) });
const reverseSchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });
const pincodeSchema = z.string().regex(/^\d{6}$/);

@ApiTags('geo')
@Controller('geo')
export class GeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
  ) {}

  @Public()
  @Get('cities')
  cities() {
    return this.prisma.city.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        state: true,
        centerLat: true,
        centerLng: true,
        zones: { where: { isActive: true }, select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Public()
  @Get('pincodes/:code')
  pincode(@Param('code', new ZodValidationPipe(pincodeSchema)) code: string) {
    return this.geo.pincode(code);
  }

  // Public, so a visitor can find their address before signing in. They proxy a rate-limited third-party service,
  // so the service caps new lookups per visitor (IP) and paces them.
  @Public()
  @Get('search')
  search(@ZodQuery(searchSchema) query: z.infer<typeof searchSchema>, @Req() req: ApiRequest) {
    return this.geo.search(query.q, req.ip ?? 'unknown');
  }

  @Public()
  @Get('reverse')
  reverse(@ZodQuery(reverseSchema) query: z.infer<typeof reverseSchema>, @Req() req: ApiRequest) {
    return this.geo.reverse(query.lat, query.lng, req.ip ?? 'unknown');
  }
}
