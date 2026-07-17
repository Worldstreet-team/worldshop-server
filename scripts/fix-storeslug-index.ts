/**
 * Repairs the unique index on `UserProfile.storeSlug`.
 *
 * THE BUG (same class as fix-cart-userid-index.ts)
 * `UserProfile.storeSlug` is optional and `@unique`. Prisma turns that into a
 * plain MongoDB unique index, and MongoDB indexes a missing/null field as the
 * value null — so only ONE non-vendor profile could exist. On a database with
 * many non-vendor users, `prisma db push` fails outright:
 *   E11000 duplicate key ... index: UserProfile_storeSlug_key dup key: { storeSlug: null }
 *
 * THE FIX
 * Create the index as a *partial* unique index that only covers documents
 * whose `storeSlug` is a string. Vendor slugs stay unique; every non-vendor
 * profile falls outside the index. `@unique` must stay in schema.prisma so
 * `findUnique({ where: { storeSlug } })` keeps working — the attribute is what
 * Prisma needs, the partial index is what MongoDB enforces.
 *
 * USAGE
 *   npm run fix:storeslug-index              # report only
 *   npm run fix:storeslug-index -- --apply   # repair
 *
 * Run this BEFORE `prisma db push` on a database with existing profiles, then
 * re-run db push to apply the rest of the schema. If db push ever replaces
 * this with a plain unique index again, re-run this script.
 */
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';

// Some local resolvers mangle the SRV lookups mongodb+srv:// needs
// (querySrv EBADRESP) — resolve via public DNS instead.
dns.setServers(['1.1.1.1', '8.8.8.8']);

const INDEX_NAME = 'UserProfile_storeSlug_key';
const COLLECTION = 'UserProfile';

/** Only index profiles whose storeSlug is an actual string — excludes null AND missing. */
const PARTIAL_FILTER = { storeSlug: { $type: 'string' } } as const;

const apply = process.argv.includes('--apply');

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  console.log(`Mode: ${apply ? 'APPLY (will modify indexes)' : 'DRY RUN (report only)'}\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connected but no database handle — check the URI has a db name');
  const profiles = db.collection(COLLECTION);

  const indexes = await profiles.indexes();
  console.log(`Indexes on "${COLLECTION}":`);
  for (const i of indexes) {
    const flags = [
      i.unique ? 'unique' : null,
      i.partialFilterExpression ? `partial=${JSON.stringify(i.partialFilterExpression)}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`  - ${i.name} ${JSON.stringify(i.key)} ${flags}`);
  }
  console.log();

  const total = await profiles.countDocuments({});
  const withString = await profiles.countDocuments({ storeSlug: { $type: 'string' } });
  const explicitNull = await profiles.countDocuments({ storeSlug: { $type: 'null' } });
  const missing = await profiles.countDocuments({ storeSlug: { $exists: false } });

  console.log('Profiles by storeSlug:');
  console.log(`  ${String(total).padStart(5)} total`);
  console.log(`  ${String(withString).padStart(5)} string  -> stay in the unique index (vendors)`);
  console.log(`  ${String(explicitNull).padStart(5)} null    -> non-vendors, excluded by the partial index`);
  console.log(`  ${String(missing).padStart(5)} missing -> non-vendors, excluded by the partial index\n`);

  // Duplicate real slugs would still block a unique index — surface them.
  const dupes = await profiles
    .aggregate<{ _id: string; n: number }>([
      { $match: { storeSlug: { $type: 'string' } } },
      { $group: { _id: '$storeSlug', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  if (dupes.length > 0) {
    console.error(`BLOCKED: ${dupes.length} store slug(s) are duplicated:`);
    for (const d of dupes.slice(0, 10)) console.error(`  ${d._id}: ${d.n} profiles`);
    console.error('\nResolve these before creating the unique index.');
    process.exit(1);
  }

  const existing = indexes.find((i) => i.name === INDEX_NAME);
  const isPartial =
    (existing?.partialFilterExpression as { storeSlug?: { $type?: string } } | undefined)
      ?.storeSlug?.$type === 'string';

  if (existing && isPartial) {
    console.log(`"${INDEX_NAME}" is ALREADY partial. Nothing to do.`);
    return;
  }

  if (!apply) {
    console.log(
      existing
        ? `"${INDEX_NAME}" exists as a PLAIN unique index — it will be dropped and recreated as partial.`
        : `"${INDEX_NAME}" is missing — it will be created as a partial unique index.`,
    );
    console.log('\nDry run — no changes made. Re-run with --apply to repair.');
    return;
  }

  if (existing) {
    console.log(`Dropping ${INDEX_NAME}...`);
    await profiles.dropIndex(INDEX_NAME);
  }

  console.log(`Creating ${INDEX_NAME} as a partial unique index...`);
  await profiles.createIndex(
    { storeSlug: 1 },
    { name: INDEX_NAME, unique: true, partialFilterExpression: PARTIAL_FILTER },
  );

  const after = (await profiles.indexes()).find((i) => i.name === INDEX_NAME);
  const afterPartial =
    (after?.partialFilterExpression as { storeSlug?: { $type?: string } } | undefined)?.storeSlug
      ?.$type === 'string';

  if (!after || !afterPartial || !after.unique) {
    console.error('\nVERIFICATION FAILED — index is not a partial unique index.');
    process.exit(1);
  }

  console.log('\nVerified:');
  console.log(
    `  ${after.name} ${JSON.stringify(after.key)} unique=${after.unique} partial=${JSON.stringify(after.partialFilterExpression)}`,
  );
  console.log('\nRe-run `npx prisma@6.19.2 db push` to apply the rest of the schema.');
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
