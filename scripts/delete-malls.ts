/**
 * Deletes malls and everything that hangs off them.
 *
 *   npm run delete:malls                    # dry run — counts only
 *   npm run delete:malls -- --apply         # every mall
 *   npm run delete:malls -- --slug naija-market --apply
 *
 * A mall owns stores (Store, kind MALL_SUBSTORE), and each of those owns
 * listings, conversations, reviews and credit entries. Prisma emulates
 * referential actions on Mongo, but only for the relations it is told to
 * traverse — so every child is deleted explicitly here, deepest first, rather
 * than trusting a cascade to reach three levels down. Anything missed would
 * survive as an orphan pointing at a store id that no longer resolves.
 *
 * What this does NOT touch: UserProfile (identity is shared with the other
 * WorldStreet apps and lives in another database), personal stores, and any
 * Report rows — a report is moderation history and outlives its target.
 *
 * Idempotent: a second run finds nothing.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const slugIndex = process.argv.indexOf('--slug');
const slug = slugIndex !== -1 ? process.argv[slugIndex + 1] : undefined;

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)');
  console.log(slug ? `Scope: mall "${slug}"\n` : 'Scope: EVERY mall\n');

  const malls = await prisma.mall.findMany({
    where: slug ? { slug } : {},
    select: { id: true, name: true, slug: true, status: true, substoreCount: true },
  });

  if (malls.length === 0) {
    console.log(slug ? `No mall with slug "${slug}".` : 'No malls exist — nothing to delete.');
    return;
  }

  const mallIds = malls.map((m) => m.id);

  const stores = await prisma.store.findMany({
    where: { mallId: { in: mallIds }, kind: 'MALL_SUBSTORE' },
    select: { id: true, name: true },
  });
  const storeIds = stores.map((s) => s.id);

  const products = await prisma.product.findMany({
    where: { storeId: { in: storeIds } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);

  const conversations = await prisma.conversation.findMany({
    where: { storeId: { in: storeIds } },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const [variants, messages, reviews, creditEntries, storeSubs, mallCharges, mallSubs] =
    await Promise.all([
      prisma.productVariant.count({ where: { productId: { in: productIds } } }),
      prisma.message.count({ where: { conversationId: { in: conversationIds } } }),
      prisma.review.count({ where: { storeId: { in: storeIds } } }),
      prisma.storeCreditEntry.count({ where: { storeId: { in: storeIds } } }),
      prisma.subscription.count({ where: { storeId: { in: storeIds } } }),
      prisma.mallSubscriptionCharge.count({ where: { mallId: { in: mallIds } } }),
      prisma.mallSubscription.count({ where: { mallId: { in: mallIds } } }),
    ]);

  console.log(`Malls (${malls.length}):`);
  for (const m of malls) {
    console.log(`  ${m.slug.padEnd(24)} ${m.status.padEnd(9)} ${m.substoreCount} store(s)  "${m.name}"`);
  }
  console.log('\nWould delete:' );
  console.log(`  ${messages} message(s)`);
  console.log(`  ${conversationIds.length} conversation(s)`);
  console.log(`  ${reviews} review(s)`);
  console.log(`  ${creditEntries} credit entr(ies)`);
  console.log(`  ${variants} product variant(s)`);
  console.log(`  ${productIds.length} listing(s)`);
  console.log(`  ${storeSubs} store subscription(s)`);
  console.log(`  ${storeIds.length} store(s)`);
  console.log(`  ${mallCharges} mall charge(s)`);
  console.log(`  ${mallSubs} mall subscription(s)`);
  console.log(`  ${malls.length} mall(s)`);

  if (!apply) {
    console.log('\nRe-run with --apply to delete all of the above.');
    return;
  }

  // Deepest first. Not one transaction: Mongo caps transaction size and time,
  // and a partial run is safe to resume — every step is a delete by id set.
  const steps: [string, () => Promise<{ count: number }>][] = [
    ['messages', () => prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } })],
    ['conversations', () => prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } })],
    ['reviews', () => prisma.review.deleteMany({ where: { storeId: { in: storeIds } } })],
    ['credit entries', () => prisma.storeCreditEntry.deleteMany({ where: { storeId: { in: storeIds } } })],
    ['product variants', () => prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } })],
    ['listings', () => prisma.product.deleteMany({ where: { id: { in: productIds } } })],
    ['store subscriptions', () => prisma.subscription.deleteMany({ where: { storeId: { in: storeIds } } })],
    ['stores', () => prisma.store.deleteMany({ where: { id: { in: storeIds } } })],
    ['mall charges', () => prisma.mallSubscriptionCharge.deleteMany({ where: { mallId: { in: mallIds } } })],
    ['mall subscriptions', () => prisma.mallSubscription.deleteMany({ where: { mallId: { in: mallIds } } })],
    ['malls', () => prisma.mall.deleteMany({ where: { id: { in: mallIds } } })],
  ];

  console.log('');
  for (const [label, run] of steps) {
    const { count } = await run();
    console.log(`  deleted ${String(count).padStart(4)} ${label}`);
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
