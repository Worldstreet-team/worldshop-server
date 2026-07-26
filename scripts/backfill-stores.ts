/**
 * Backfills the Store model from the legacy vendor fields on UserProfile, and
 * repoints existing listings at their new store.
 *
 *   npm run backfill:stores              # dry run
 *   npm run backfill:stores -- --apply
 *
 * Dry-run by default and idempotent: a profile that already has a Store is
 * skipped, so re-running only picks up what is new.
 *
 * Backfilled stores land in DRAFT with a PENDING_PAYMENT subscription — the
 * same state a brand-new store gets. That is deliberate: existing vendors
 * never agreed to a subscription, so activating them for free would be
 * inventing consent, and marking them ACTIVE without a charge would put stores
 * live that nobody has paid for. They keep their data and go live the moment
 * they pay.
 *
 * Run BEFORE `npm run teardown -- stores`, which clears the source fields.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';
import { slugify } from '../src/utils/slugify';
import { DEFAULT_PLAN_CODE } from '../src/services/subscription.service';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

/** Vendors predate the "state is required" rule, so they need a placeholder. */
const UNKNOWN_STATE = 'Unspecified';

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const plan = await prisma.subscriptionPlan.findUnique({ where: { code: DEFAULT_PLAN_CODE } });
  if (!plan) {
    console.error(`Plan "${DEFAULT_PLAN_CODE}" not found. Run \`npm run seed:plans -- --apply\` first.`);
    process.exit(1);
  }

  const vendors = await prisma.userProfile.findMany({
    where: { isVendor: true },
    select: {
      userId: true,
      email: true,
      phone: true,
      storeName: true,
      storeSlug: true,
      storeDescription: true,
      vendorStatus: true,
      vendorSince: true,
    },
  });

  console.log(`Found ${vendors.length} vendor profiles.\n`);

  const takenSlugs = new Set(
    (await prisma.store.findMany({ select: { slug: true } })).map((s) => s.slug),
  );

  let created = 0;
  let skipped = 0;
  let relinked = 0;

  for (const vendor of vendors) {
    const existing = await prisma.store.findUnique({
      where: { ownerId: vendor.userId },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const name = vendor.storeName?.trim() || `Store ${vendor.userId.slice(-6)}`;

    // Prefer the slug buyers may already have links to.
    let slug = vendor.storeSlug?.trim() || slugify(name) || `store-${vendor.userId.slice(-6)}`;
    if (takenSlugs.has(slug)) {
      let n = 2;
      while (takenSlugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    takenSlugs.add(slug);

    const listingCount = await prisma.product.count({ where: { vendorId: vendor.userId } });

    console.log(
      `  ${(vendor.storeName || '(unnamed)').slice(0, 28).padEnd(30)} → /${slug.padEnd(28)} ${listingCount} listings`,
    );

    created += 1;
    if (!apply) continue;

    const store = await prisma.store.create({
      data: {
        ownerId: vendor.userId,
        name,
        slug,
        description: vendor.storeDescription,
        email: vendor.email,
        phone: vendor.phone,
        state: UNKNOWN_STATE,
        // Banned vendors stay banned; everyone else starts unpaid.
        status: vendor.vendorStatus === 'BANNED' ? 'BANNED' : 'DRAFT',
        listingCount,
        createdAt: vendor.vendorSince ?? new Date(),
      },
    });

    await prisma.subscription.create({
      data: { storeId: store.id, planId: plan.id, status: 'PENDING_PAYMENT' },
    });

    const linked = await prisma.product.updateMany({
      where: { vendorId: vendor.userId },
      data: { storeId: store.id },
    });

    relinked += linked.count;
  }

  // A never-written Mongo field is *missing*, not null, and Prisma treats the
  // two as different — `storeId: null` alone silently matches nothing.
  const orphans = await prisma.product.count({
    where: {
      vendorId: { not: null },
      OR: [{ storeId: null }, { storeId: { isSet: false } }],
    },
  });

  console.log(`\n${apply ? 'Created' : 'Would create'} ${created} stores (${skipped} already existed).`);
  if (apply) console.log(`Repointed ${relinked} listings.`);
  console.log(`Listings still without a store: ${orphans}${orphans ? ' — check these before making storeId required.' : ''}`);
  console.log('\nBackfilled stores are DRAFT / PENDING_PAYMENT — they go live when their owner pays.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
