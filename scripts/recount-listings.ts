/**
 * Resyncs Store.listingCount with the store's published listings.
 *
 * The counter is refreshed by the listing service on every publish, unpublish
 * and delete, but listings removed by other means (scripts, direct database
 * work) leave it stale. Store cards print it and browse sorts by it, so a
 * stale value shows "1 listing" on a store with nothing for sale.
 *
 *   npm run recount:listings             # dry run: lists the mismatches
 *   npm run recount:listings -- --apply
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

async function main() {
  const [stores, counts] = await Promise.all([
    prisma.store.findMany({ select: { id: true, slug: true, status: true, listingCount: true } }),
    prisma.product.groupBy({ by: ['storeId'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
  ]);
  const published = new Map(counts.map((c) => [c.storeId, c._count._all]));
  const stale = stores.filter((s) => (published.get(s.id) ?? 0) !== s.listingCount);

  console.log(`${stores.length} stores, ${stale.length} stale. ${apply ? 'Applying.' : 'Dry run: nothing is written. Pass --apply to write.'}`);
  for (const s of stale) {
    const real = published.get(s.id) ?? 0;
    console.log(`  ${s.slug} (${s.status}): ${s.listingCount} -> ${real}`);
    if (apply) await prisma.store.update({ where: { id: s.id }, data: { listingCount: real } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
