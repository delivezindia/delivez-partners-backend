import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { corsOrigin } from '../common/public-url';
import { EventBus, type DomainEvent } from '../events/event-bus.service';
import { TokenService, type AccessClaims } from '../modules/identity/token.service';
import { PartnerAccessService } from '../modules/partners/partner-access.service';
import { PrismaService } from '../prisma/prisma.service';

type ClientData = { claims: AccessClaims };

// Room conventions (plan §11.3): store:{id}, order:{id}, city:{id}, rider:{id}, user:{id}
@WebSocketGateway({ cors: { origin: corsOrigin, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private unsubscribe?: () => void;

  @WebSocketServer() server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly events: EventBus,
    private readonly partnerAccess: PartnerAccessService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.subscribe('*', (event) => this.route(event));
  }

  onModuleDestroy() {
    this.unsubscribe?.();
  }

  handleConnection(client: Socket) {
    const token = (client.handshake.auth?.token as string | undefined) ?? undefined;
    try {
      if (!token) throw new Error('missing token');
      const claims = this.tokens.verifyAccess(token);
      (client.data as ClientData).claims = claims;
      void client.join(`user:${claims.sub}`);
    } catch {
      client.emit('error', { code: 'AUTH_REQUIRED' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: string }) {
    const claims = (client.data as ClientData).claims;
    const room = body?.room ?? '';
    const [kind, id] = room.split(':');
    if (kind === 'store' && id && claims.app === 'PARTNERS') {
      const access = await this.partnerAccess.forStore(claims.sub, id);
      if (access) {
        await client.join(room);
        return { ok: true, room };
      }
    }
    // Customers may follow their own orders and lab bookings.
    if ((kind === 'order' || kind === 'booking') && id && claims.app === 'LOCAL') {
      const where = { id, customer: { userId: claims.sub } };
      const own = kind === 'order' ? await this.prisma.order.findFirst({ where, select: { id: true } }) : await this.prisma.labBooking.findFirst({ where, select: { id: true } });
      if (own) {
        await client.join(room);
        return { ok: true, room };
      }
    }
    return { ok: false, room, error: 'ROOM_ACCESS_DENIED' };
  }

  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: string }) {
    if (body?.room) await client.leave(body.room);
    return { ok: true };
  }

  private route(event: DomainEvent) {
    const data = event.data as { storeId?: string; orderId?: string; bookingId?: string; userId?: string };
    const rooms = [data.storeId && `store:${data.storeId}`, data.userId && `user:${data.userId}`].filter(Boolean) as string[];
    if (rooms.length) this.server.to(rooms).emit(event.type, event);
    // Customer rooms get only a "something changed" signal; the app refetches its own view.
    const ping = { id: event.id, type: event.type, occurredAt: event.occurredAt, data: { orderId: data.orderId, bookingId: data.bookingId } };
    if (data.orderId) this.server.to(`order:${data.orderId}`).emit(event.type, ping);
    if (data.bookingId) this.server.to(`booking:${data.bookingId}`).emit(event.type, ping);
  }
}
