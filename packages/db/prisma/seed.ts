// Pilot seed (plan Appendix C). Idempotent: safe to run repeatedly.
import { PrismaClient, LegalDocType, AdminRole } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

// Rough bounding polygons; replace with OpenStreetMap boundaries later.
function box(lat1: number, lng1: number, lat2: number, lng2: number) {
  return {
    type: 'Polygon',
    coordinates: [[[lng1, lat1], [lng2, lat1], [lng2, lat2], [lng1, lat2], [lng1, lat1]]],
  };
}

async function main() {
  const city = await prisma.city.upsert({
    where: { name_state: { name: 'Bengaluru', state: 'Karnataka' } },
    update: {},
    create: { name: 'Bengaluru', state: 'Karnataka', centerLat: 12.9716, centerLng: 77.5946 },
  });

  const zoneDefs = [
    { name: 'Indiranagar', polygon: box(12.955, 77.625, 12.99, 77.655), pincodes: ['560038'] },
    { name: 'HSR Layout', polygon: box(12.9, 77.625, 12.925, 77.66), pincodes: ['560102'] },
    { name: 'Koramangala', polygon: box(12.92, 77.6, 12.945, 77.64), pincodes: ['560034', '560095'] },
  ];
  for (const z of zoneDefs) {
    const zone = await prisma.zone.upsert({
      where: { cityId_name: { cityId: city.id, name: z.name } },
      update: { polygon: z.polygon },
      create: { cityId: city.id, name: z.name, polygon: z.polygon },
    });
    for (const code of z.pincodes) {
      await prisma.pincode.upsert({
        where: { code },
        update: { zoneId: zone.id, cityId: city.id },
        create: { code, cityId: city.id, zoneId: zone.id },
      });
    }
  }

  await prisma.stateDrugRule.upsert({
    where: { state: 'Karnataka' },
    update: {},
    create: { state: 'Karnataka', codAllowedForRx: false, rxValidityDays: 180 },
  });

  const version = '2026.10';
  const legalTypes = Object.values(LegalDocType);
  for (const type of legalTypes) {
    const state = type === 'STATE_RIDER' ? 'Karnataka' : null;
    const existing = await prisma.legalDocumentVersion.findFirst({ where: { type, version, state } });
    if (!existing) {
      await prisma.legalDocumentVersion.create({
        data: {
          type,
          version,
          state,
          contentUrl: `https://delivez.com/legal/${type.toLowerCase()}/${version}`,
          contentHash: createHash('sha256').update(`${type}:${version}:${state ?? ''}`).digest('hex'),
          effectiveFrom: new Date('2026-10-01T00:00:00Z'),
        },
      });
    }
  }

  const admins: { phone: string; name: string; role: AdminRole; cityIds: string[] }[] = [
    { phone: '+919999900001', name: 'Founder', role: 'FOUNDER', cityIds: [] },
    { phone: '+919999900002', name: 'Bengaluru City Ops', role: 'CITY_OPS', cityIds: [city.id] },
    { phone: '+919999900003', name: 'Compliance', role: 'COMPLIANCE', cityIds: [] },
    { phone: '+919999900004', name: 'Finance', role: 'FINANCE', cityIds: [] },
  ];
  for (const a of admins) {
    const user = await prisma.user.upsert({
      where: { phone: a.phone },
      update: {},
      create: { phone: a.phone, fullName: a.name, phoneVerified: true },
    });
    await prisma.adminUser.upsert({
      where: { userId: user.id },
      update: { role: a.role, cityIds: a.cityIds },
      create: { userId: user.id, role: a.role, cityIds: a.cityIds },
    });
  }

  // Demo LIVE restaurant so the Partners app has something to show after login.
  const owner = await prisma.user.upsert({
    where: { phone: '+919000000001' },
    update: {},
    create: { phone: '+919000000001', fullName: 'Meghana Owner', phoneVerified: true },
  });
  const existingStore = await prisma.store.findUnique({ where: { slug: 'meghana-foods-indiranagar' } });
  if (!existingStore) {
    const account = await prisma.partnerAccount.create({
      data: {
        legalName: 'Meghana Foods Pvt Ltd',
        displayName: 'Meghana Foods',
        partnerType: 'PVT_LTD',
        contactPhone: owner.phone,
        members: { create: { userId: owner.id, role: 'OWNER', storeIds: [], acceptedAt: new Date() } },
      },
    });
    const indiranagar = await prisma.zone.findFirstOrThrow({ where: { cityId: city.id, name: 'Indiranagar' } });
    await prisma.store.create({
      data: {
        partnerAccountId: account.id,
        name: 'Meghana Foods – Indiranagar',
        slug: 'meghana-foods-indiranagar',
        vertical: 'EAT',
        storeType: 'RESTAURANT',
        cuisines: ['Biryani', 'Andhra', 'North Indian'],
        phone: owner.phone,
        addressLine1: '12, 100 Feet Rd',
        landmark: 'Opp. Metro station',
        pincode: '560038',
        cityId: city.id,
        zoneId: indiranagar.id,
        lat: 12.9784,
        lng: 77.6408,
        geohash: 'tdr1y7x',
        addressConfidence: 'HIGH',
        status: 'LIVE',
        openState: 'OPEN',
        readinessScore: 92,
        liveAt: new Date(),
        packagingFee: 1000,
        timings: {
          create: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: '10:00', closesAt: '23:00' })),
        },
      },
    });
    const store = await prisma.store.findUniqueOrThrow({ where: { slug: 'meghana-foods-indiranagar' } });
    const biryani = await prisma.category.create({ data: { storeId: store.id, name: 'Biryani', sortOrder: 1 } });
    const breads = await prisma.category.create({ data: { storeId: store.id, name: 'Breads', sortOrder: 2 } });
    const drinks = await prisma.category.create({ data: { storeId: store.id, name: 'Beverages', sortOrder: 3 } });
    await prisma.product.createMany({
      data: [
        { storeId: store.id, categoryId: biryani.id, name: 'Chicken Biryani', price: 32000, isVeg: false, prepMinutes: 20 },
        { storeId: store.id, categoryId: biryani.id, name: 'Paneer Biryani', price: 28000, isVeg: true, prepMinutes: 20 },
        { storeId: store.id, categoryId: breads.id, name: 'Butter Naan', price: 6000, isVeg: true, prepMinutes: 8 },
        { storeId: store.id, categoryId: breads.id, name: 'Tandoori Roti', price: 4000, isVeg: true, prepMinutes: 8 },
        { storeId: store.id, categoryId: drinks.id, name: 'Coke 500ml', price: 6000, isVeg: true, unit: 'piece' },
      ],
    });
  }

  console.log('Seed complete: Bengaluru, 3 zones, legal docs, 4 admins, 1 demo restaurant.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
