// Sample shops for a Delivez server: the 20 sample shops in Lucknow (one of every kind) with their menu sections,
// products, prices, variants, add-ons, stock counts and weekly hours.
//
// Left out on purpose: orders, payments, customers, admin accounts, reviews, documents, bank details, and the sample
// pharmacist and pathologist (they need real people with real registration numbers; the pharmacy and lab add theirs in
// the shop app before they can check prescriptions or sign reports).
//
//   node --env-file=.env scripts/sample-shops.mjs export             write scripts/sample-shops/lucknow.json from this database
//   node --env-file=.env scripts/sample-shops.mjs import --dry-run   show what would be added; changes nothing
//   node --env-file=.env scripts/sample-shops.mjs import             add them, in one transaction
//   node --env-file=.env scripts/sample-shops.mjs remove             take back exactly what `import` added
//
// `import` skips a shop whose name is already used in that city, and records what it added in
// sample-shops-imported.json (repo root) for `remove`. OWNER_PHONE=+91… picks the shop-app account they belong to
// (default: the owner in the file); an existing account with that phone is used as it is.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ROOT = new URL('..', import.meta.url);
const { PrismaClient } = createRequire(new URL('apps/core-api/package.json', ROOT))('@delivez/db');
const FILE = new URL('scripts/sample-shops/lucknow.json', ROOT);
const MANIFEST = new URL('sample-shops-imported.json', ROOT);
const db = new PrismaClient();

const STORE_FIELDS = ['name', 'slug', 'vertical', 'storeType', 'cuisines', 'description', 'phone', 'whatsappPhone', 'addressLine1', 'addressLine2', 'landmark', 'pincode', 'lat', 'lng', 'geohash', 'addressConfidence', 'status', 'readinessScore', 'supportsDelivery', 'supportsPickup', 'deliveryRadiusKm', 'expressEnabled', 'defaultPrepMinutes', 'peakPrepMinutes', 'aiPrepEnabled', 'aiAlertsEnabled', 'aiAutoExtendEta', 'aiMenuAutoPause', 'aiAggressiveness', 'acceptMultipleOrders', 'allowSubstitutions', 'maxOrdersPerHour', 'autoPauseOverloaded', 'autoAcceptOrders', 'minOrderAmount', 'packagingFee', 'collectionFee', 'allowGenericSubstitution', 'contactIfRxUnclear', 'selfPackagingConfirmed', 'commissionPct', 'settlementCycle', 'deliveryFeeBearer'];
const PRODUCT_FIELDS = ['name', 'description', 'sku', 'barcode', 'unit', 'unitSize', 'price', 'mrp', 'taxRatePct', 'hsnCode', 'isAvailable', 'isComplex', 'prepMinutes', 'maxQtyPerOrder', 'sortOrder', 'isVeg', 'spiceLevel', 'prescriptionRequired', 'drugSchedule', 'saltComposition', 'manufacturer', 'substitutionAllowed', 'labSampleType', 'labFastingHours', 'labReportHours', 'labHomeCollection', 'labWalkIn', 'labParameters', 'labPreparation', 'tags'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function exportShops() {
  const city = process.env.SAMPLE_CITY ?? 'lucknow';
  const stores = await db.store.findMany({
    where: { city: { name: { equals: city, mode: 'insensitive' } }, status: 'LIVE' },
    include: {
      city: true,
      zone: true,
      timings: true,
      categories: true,
      products: { where: { deletedAt: null }, include: { variants: true, addonGroups: { include: { addons: true } }, inventory: true } },
      partnerAccount: { include: { members: { where: { role: 'OWNER' }, include: { user: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  if (!stores.length) throw new Error(`no live shops in ${city}`);
  const account = stores[0].partnerAccount;
  const owner = account.members[0]?.user;
  const data = {
    city: stores[0].city.name,
    exportedAt: new Date().toISOString(),
    // Emails are left out: the sample ones are made up, and owners add their own in Settings.
    owner: { phone: owner?.phone ?? account.contactPhone, fullName: owner?.fullName ?? null, ...pick(account, ['legalName', 'displayName', 'partnerType']) },
    stores: stores.map((s) => ({
      store: pick(s, STORE_FIELDS),
      zone: s.zone?.name ?? null,
      timings: s.timings.map((t) => pick(t, ['dayOfWeek', 'opensAt', 'closesAt', 'isClosed'])),
      categories: s.categories.map((c) => pick(c, ['name', 'sortOrder', 'isActive'])),
      products: s.products.map((p) => ({
        ...pick(p, PRODUCT_FIELDS),
        category: s.categories.find((c) => c.id === p.categoryId)?.name ?? null,
        variants: p.variants.map((v) => pick(v, ['name', 'priceDiff', 'isDefault'])),
        addonGroups: p.addonGroups.map((g) => ({ ...pick(g, ['name', 'minSelect', 'maxSelect']), addons: g.addons.map((a) => pick(a, ['name', 'price', 'isVeg'])) })),
        inventory: p.inventory ? pick(p.inventory, ['trackStock', 'stockQty', 'lowStockThreshold', 'batchNo', 'expiryDate']) : null,
      })),
    })),
  };
  mkdirSync(new URL('.', FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  console.log(`exported ${data.stores.length} shops, ${data.stores.reduce((n, s) => n + s.products.length, 0)} products from ${data.city}`);
}

async function importShops(dry) {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  if (existsSync(MANIFEST)) throw new Error('sample-shops-imported.json is here: these shops were imported already. Run `remove` first to import them again.');
  const city = await db.city.findFirst({ where: { name: { equals: data.city, mode: 'insensitive' } }, include: { zones: true } });
  if (!city) throw new Error(`the city "${data.city}" isn't set up on this server (Ops console → Cities)`);
  const phone = process.env.OWNER_PHONE ?? data.owner.phone;
  const user = await db.user.findUnique({ where: { phone } });
  const member = user ? await db.partnerMember.findFirst({ where: { userId: user.id, role: 'OWNER', isActive: true }, orderBy: { createdAt: 'asc' } }) : null;
  const names = (await db.store.findMany({ where: { cityId: city.id }, select: { name: true } })).map((s) => s.name);
  const add = data.stores.filter((s) => !names.some((n) => same(n, s.store.name)));
  const skip = data.stores.filter((s) => !add.includes(s));
  const usedSlugs = new Set((await db.store.findMany({ where: { slug: { in: add.map((s) => s.store.slug) } }, select: { slug: true } })).map((s) => s.slug));

  console.log(`${dry ? 'DRY RUN, nothing is changed. ' : ''}City: ${city.name}`);
  console.log(`Owner: ${phone} · ${user ? `existing user${member ? ', their shop account is used' : ', a shop account is created for them'}` : 'new user and shop account are created'}`);
  console.log(`Add ${add.length} shops, ${add.reduce((n, s) => n + s.products.length, 0)} products:`);
  for (const s of add) console.log(`  + ${s.store.name} (${s.store.vertical}, ${s.products.length} products, ${s.timings.length} opening times)`);
  for (const s of skip) console.log(`  = ${s.store.name}: skipped, a shop with this name is already in ${city.name}`);
  if (dry || !add.length) return;

  const made = { at: new Date().toISOString(), city: city.name, ownerPhone: phone, createdUserId: null, createdPartnerAccountId: null, stores: [] };
  await db.$transaction(
    async (tx) => {
      let userId = user?.id;
      let accountId = member?.partnerAccountId;
      if (!userId) {
        userId = (await tx.user.create({ data: { phone, fullName: data.owner.fullName } })).id;
        made.createdUserId = userId;
      }
      if (!accountId) {
        const o = data.owner;
        accountId = (await tx.partnerAccount.create({ data: { legalName: o.legalName, displayName: o.displayName, partnerType: o.partnerType, contactPhone: phone } })).id;
        await tx.partnerMember.create({ data: { userId, partnerAccountId: accountId, role: 'OWNER', isActive: true, acceptedAt: new Date() } });
        made.createdPartnerAccountId = accountId;
      }
      for (const s of add) {
        const slug = usedSlugs.has(s.store.slug) ? `${s.store.slug}-${randomUUID().slice(0, 4)}` : s.store.slug;
        const zone = s.zone ? city.zones.find((z) => same(z.name, s.zone)) : null;
        const store = await tx.store.create({
          // Closed "by the hours" (AUTO_HOURS, the marker in stores/open-state.scheduler.ts), so the API opens each shop
          // within a minute when it is inside its opening times and keeps following them. A plain CLOSED would read as
          // the owner having closed it, and it would never open by itself.
          data: { ...s.store, slug, partnerAccountId: accountId, cityId: city.id, zoneId: zone?.id ?? null, openState: 'CLOSED', closedReason: 'AUTO_HOURS', liveAt: s.store.status === 'LIVE' ? new Date() : null, timings: { create: s.timings } },
        });
        const cats = new Map();
        for (const c of s.categories) cats.set(c.name, (await tx.category.create({ data: { ...c, storeId: store.id } })).id);
        for (const p of s.products) {
          const { category, variants, addonGroups, inventory, ...fields } = p;
          await tx.product.create({
            data: {
              ...fields,
              storeId: store.id,
              categoryId: category ? (cats.get(category) ?? null) : null,
              variants: { create: variants },
              addonGroups: { create: addonGroups.map(({ addons, ...g }) => ({ ...g, addons: { create: addons } })) },
              ...(inventory ? { inventory: { create: { ...inventory, expiryDate: inventory.expiryDate ? new Date(inventory.expiryDate) : null } } } : {}),
            },
          });
        }
        made.stores.push({ id: store.id, name: store.name, slug });
      }
    },
    { timeout: 120_000 },
  );
  writeFileSync(MANIFEST, JSON.stringify(made, null, 2) + '\n');
  console.log(`Added ${made.stores.length} shops. They open by their hours; what was added is listed in sample-shops-imported.json (used by \`remove\`).`);
}

async function removeShops() {
  if (!existsSync(MANIFEST)) throw new Error('sample-shops-imported.json is not here: nothing to remove (it is written by `import`).');
  const made = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const s of made.stores) {
    try {
      await db.store.delete({ where: { id: s.id } });
      console.log(`  - ${s.name}: removed`);
    } catch (e) {
      if (e.code === 'P2025') {
        console.log(`  - ${s.name}: already gone`);
        continue;
      }
      // Something real points at it now (an order, a booking, a cart): hide it instead of deleting.
      await db.store.update({ where: { id: s.id }, data: { status: 'SUSPENDED', openState: 'CLOSED', closedReason: 'Sample shop removed' } });
      console.log(`  ! ${s.name}: has orders or other records, so it is suspended (hidden from customers) instead of deleted`);
    }
  }
  if (made.createdPartnerAccountId && !(await db.store.count({ where: { partnerAccountId: made.createdPartnerAccountId } }))) {
    await db.partnerMember.deleteMany({ where: { partnerAccountId: made.createdPartnerAccountId } });
    await db.partnerAccount.delete({ where: { id: made.createdPartnerAccountId } });
    console.log('  - the shop account created for them: removed');
  }
  if (made.createdUserId) {
    await db.user.delete({ where: { id: made.createdUserId } }).then(
      () => console.log('  - the owner user created for them: removed'),
      () => console.log('  ! the owner user created for them has logged in since, so it is kept'),
    );
  }
  renameSync(MANIFEST, new URL(`sample-shops-removed-${made.at.slice(0, 10)}.json`, ROOT));
  console.log('Done.');
}

const [cmd, flag] = process.argv.slice(2);
const run = { export: exportShops, import: () => importShops(flag === '--dry-run'), remove: removeShops }[cmd];
if (!run) {
  console.log('Usage: node --env-file=.env scripts/sample-shops.mjs export | import [--dry-run] | remove');
  process.exit(1);
}
try {
  await run();
} catch (e) {
  console.error('✘ ' + e.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
