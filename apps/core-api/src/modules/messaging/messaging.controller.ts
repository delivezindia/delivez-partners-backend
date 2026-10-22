import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../common/api-exception.filter';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, AdminRoles, ROLES } from '../admin/admin.guard';
import { Apps } from '../identity/auth.decorators';
import { MessagingService } from './messaging.service';

const listQuery = z.object({ phone: z.string().max(20).optional(), channel: z.enum(['SMS', 'WHATSAPP']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });

/** Dev phone inbox: every SMS / WhatsApp the system "sent" locally. Not available in production. */
@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/dev/messages')
export class DevMessagesController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @AdminRoles(...ROLES.READ)
  async list(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    return { providers: { SMS: this.messaging.providerFor('SMS'), WHATSAPP: this.messaging.providerFor('WHATSAPP') }, messages: await this.messaging.list(q) };
  }
}
