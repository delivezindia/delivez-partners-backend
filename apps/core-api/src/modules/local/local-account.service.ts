import { HttpStatus, Injectable } from '@nestjs/common';
import type { AddressLabel } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';

export interface AddressInput {
  label: AddressLabel;
  contactName?: string;
  contactPhone?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  pincode: string;
  cityName: string;
  state: string;
  lat: number;
  lng: number;
  placeId?: string;
  isDefault?: boolean;
}

const MAX_ADDRESSES = 20;

/** The customer's own profile and saved addresses (Local app). */
@Injectable()
export class LocalAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every Local login has a customer row (created on first login). */
  async customer(userId: string) {
    return this.prisma.customer.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async me(userId: string) {
    const [user, customer] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          phone: true,
          fullName: true,
          email: true,
          language: true,
        },
      }),
      this.customer(userId),
    ]);
    return {
      ...user,
      defaultAddressId: customer.defaultAddressId,
      marketingOptIn: customer.marketingOptIn,
      whatsappOptIn: customer.whatsappOptIn,
    };
  }

  async updateMe(
    userId: string,
    input: {
      fullName?: string;
      email?: string | null;
      whatsappOptIn?: boolean;
      marketingOptIn?: boolean;
    },
  ) {
    if (input.email) {
      const taken = await this.prisma.user.findFirst({
        where: {
          email: { equals: input.email, mode: 'insensitive' },
          id: { not: userId },
        },
        select: { id: true },
      });
      if (taken) throw new ApiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'This email is already used by another Delivez account');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: input.fullName, email: input.email },
    });
    const c = await this.customer(userId);
    await this.prisma.customer.update({
      where: { id: c.id },
      data: {
        whatsappOptIn: input.whatsappOptIn,
        marketingOptIn: input.marketingOptIn,
      },
    });
    return this.me(userId);
  }

  async addresses(userId: string) {
    const c = await this.customer(userId);
    const rows = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((a) => ({ ...a, isDefault: a.id === c.defaultAddressId }));
  }

  async addAddress(userId: string, input: AddressInput) {
    const count = await this.prisma.address.count({
      where: { userId, deletedAt: null },
    });
    if (count >= MAX_ADDRESSES) throw new ApiError(HttpStatus.CONFLICT, 'TOO_MANY_ADDRESSES', `You can save up to ${MAX_ADDRESSES} addresses — remove one first`);
    const { isDefault, ...data } = input;
    const a = await this.prisma.address.create({ data: { ...data, userId } });
    // The first address (or one marked default) becomes the default.
    const c = await this.customer(userId);
    if (isDefault || !c.defaultAddressId)
      await this.prisma.customer.update({
        where: { id: c.id },
        data: { defaultAddressId: a.id },
      });
    return (await this.addresses(userId)).find((x) => x.id === a.id)!;
  }

  async updateAddress(userId: string, id: string, input: AddressInput) {
    await this.mustOwn(userId, id);
    const { isDefault, ...data } = input;
    await this.prisma.address.update({ where: { id }, data });
    if (isDefault) {
      const c = await this.customer(userId);
      await this.prisma.customer.update({
        where: { id: c.id },
        data: { defaultAddressId: id },
      });
    }
    return (await this.addresses(userId)).find((x) => x.id === id)!;
  }

  /** Soft delete: past orders keep pointing at the address. */
  async removeAddress(userId: string, id: string) {
    await this.mustOwn(userId, id);
    await this.prisma.address.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    const c = await this.customer(userId);
    if (c.defaultAddressId === id) {
      const next = await this.prisma.address.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      await this.prisma.customer.update({
        where: { id: c.id },
        data: { defaultAddressId: next?.id ?? null },
      });
    }
    return this.addresses(userId);
  }

  private async mustOwn(userId: string, id: string) {
    const a = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!a) throw new ApiError(HttpStatus.NOT_FOUND, 'ADDRESS_NOT_FOUND', 'Address not found');
    return a;
  }
}
