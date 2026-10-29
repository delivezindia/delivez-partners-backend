import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';

export type ReviewFilter = 'ALL' | 'UNREPLIED' | 'LOW';

/** Customer ratings for one store: what people said, the spread of stars, and the shop's public reply. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async list(storeId: string, q: { filter: ReviewFilter; before?: string; limit: number }) {
    const base: Prisma.ReviewWhereInput = { storeId, isHidden: false };
    const where: Prisma.ReviewWhereInput = {
      ...base,
      ...(q.filter === 'UNREPLIED' ? { reply: null } : q.filter === 'LOW' ? { rating: { lte: 2 } } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    };
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const [rows, store, stars, recent, unreplied] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit + 1,
        select: { id: true, rating: true, comment: true, tags: true, reply: true, repliedAt: true, createdAt: true, order: { select: { id: true, orderNumber: true } }, customer: { select: { user: { select: { fullName: true } } } } },
      }),
      this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { avgRating: true, ratingCount: true } }),
      this.prisma.review.groupBy({ by: ['rating'], where: base, _count: { _all: true } }),
      this.prisma.review.aggregate({ where: { ...base, createdAt: { gte: since30 } }, _avg: { rating: true }, _count: { _all: true } }),
      this.prisma.review.count({ where: { ...base, reply: null } }),
    ]);
    const page = rows.slice(0, q.limit);
    const round = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
    return {
      summary: {
        avg: store.ratingCount ? round(store.avgRating) : null,
        count: store.ratingCount,
        stars: Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, stars.find((x) => x.rating === n)?._count._all ?? 0])),
        last30: { avg: round(recent._avg.rating), count: recent._count._all },
        unreplied,
      },
      items: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        tags: r.tags,
        reply: r.reply,
        repliedAt: r.repliedAt,
        createdAt: r.createdAt,
        orderId: r.order.id,
        orderNumber: r.order.orderNumber,
        // First name only, like the order board.
        customer: r.customer.user.fullName?.trim().split(/\s+/)[0] || 'Customer',
      })),
      nextBefore: rows.length > q.limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  /** The shop's public answer, shown to the customer on their order. Can be edited; the customer hears about the first one. */
  async reply(storeId: string, reviewId: string, text: string, userId: string) {
    const r = await this.prisma.review.findFirst({ where: { id: reviewId, storeId, isHidden: false }, select: { id: true, reply: true, orderId: true, order: { select: { orderNumber: true } } } });
    if (!r) throw new ApiError(HttpStatus.NOT_FOUND, 'REVIEW_NOT_FOUND', 'Review not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({ where: { id: r.id }, data: { reply: text, repliedAt: new Date() } });
      if (!r.reply) await this.events.publish(tx, { type: 'review.replied', data: { storeId, orderId: r.orderId, orderNumber: r.order.orderNumber, reviewId: r.id }, actor: { type: 'PARTNER', userId } });
    });
    return { ok: true };
  }
}
