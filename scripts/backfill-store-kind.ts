/**
 * Backfills `kind: PERSONAL` onto every existing Store document.
 *
 *   npm run backfill:store-kind              # dry run
 *   npm run backfill:store-kind -- --apply
 *
 * Why this exists: the malls feature added `kind StoreKind @default(PERSONAL)`
 * to Store, but a Prisma `@default` is applied on WRITE only — pre-existing
 * Mongo documents simply lack the field, and a filter like
 * `findFirst({ where: { ownerId, kind: 'PERSONAL' } })` will NOT match them.
 * Run this once, immediately after `prisma db push`, before deploying any code
 * that filters on `kind`. Idempotent and additive — re-running rewrites the
 * same value; it never touches MALL_SUBSTORE stores (none exist before the
 * feature ships, and afterwards the filter below skips them).
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  const total = await prisma.store.count();
  // Prisma cannot filter "unset" on a required field, and its filter
  // translations around missing fields are exactly the trap this script fixes
  // — so go through the raw command layer where `$exists` is unambiguous.
  const unsetFilter = { kind: { $exists: false } };
  const pending = (await prisma.store.aggregateRaw({
    pipeline: [{ $match: unsetFilter }, { $count: 'n' }],
  })) as unknown as Array<{ n: number }>;
  const missing = pending[0]?.n ?? 0;
  console.log(`  ${total} store(s) total, ${missing} missing \`kind\``);

  if (!apply) {
    console.log(`\nWould backfill kind=PERSONAL on ${missing} store(s).`);
    return;
  }

  const result = (await prisma.$runCommandRaw({
    update: 'Store',
    updates: [
      { q: unsetFilter, u: { $set: { kind: 'PERSONAL' } }, multi: true },
    ],
  })) as { nModified?: number; n?: number };
  console.log(`\nBackfilled kind=PERSONAL on ${result.nModified ?? result.n ?? 0} store(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
