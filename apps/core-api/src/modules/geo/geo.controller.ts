import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
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

  // Authenticated: these proxy a rate-limited third-party service.
  @Get('search')
  search(@Query(new ZodValidationPipe(searchSchema)) query: z.infer<typeof searchSchema>) {
    return this.geo.search(query.q);
  }

  @Get('reverse')
  reverse(@Query(new ZodValidationPipe(reverseSchema)) query: z.infer<typeof reverseSchema>) {
    return this.geo.reverse(query.lat, query.lng);
  }
}
