/**
 * Backfills `country: "NG"` onto every Store, Mall and Product document that
 * predates the field.
 *
 *   npm run backfill:country              # dry run
 *   npm run backfill:country -- --apply
 *
 * Why this exists: going global added `country String @default("NG")` to all
 * three models, but a Prisma `@default` is applied on WRITE only — existing
 * Mongo documents simply lack the field, and a browse filter like
 * `where: { country: 'NG' }` will NOT match them (see backfill-store-kind.ts
 * for the same trap). Run once, right after `prisma db push`, before deploying
 * the country filter. Idempotent and additive.
 */
import 'dotenv/config';
import dns from 'node:dns';
import prisma from '../src/configs/prismaConfig';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');
const COLLECTIONS = ['Store', 'Mall', 'Product'] as const;
const unsetFilter = { country: { $exists: false } };

async function main() {
  console.log(apply ? 'APPLYING' : 'DRY RUN (re-run with --apply)', '\n');

  for (const collection of COLLECTIONS) {
    const counted = (await prisma.$runCommandRaw({
      count: collection,
      query: unsetFilter,
    })) as { n?: number };
    const missing = counted.n ?? 0;
    console.log(`  ${collection}: ${missing} document(s) missing \`country\``);

    if (!apply || missing === 0) continue;

    const result = (await prisma.$runCommandRaw({
      update: collection,
      updates: [{ q: unsetFilter, u: { $set: { country: 'NG' } }, multi: true }],
    })) as { nModified?: number; n?: number };
    console.log(`    → backfilled country=NG on ${result.nModified ?? result.n ?? 0}`);
  }

  if (!apply) console.log('\nNothing written. Re-run with --apply to backfill.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
