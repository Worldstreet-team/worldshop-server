/**
 * Repairs the unique index on `Cart.userId`.
 *
 * THE BUG
 * `Cart.userId` is optional and `@unique`. Prisma turns that into a plain
 * MongoDB unique index, and MongoDB treats a *missing* field as null — a value
 * like any other. Guest carts never set `userId`, so the first guest cart takes
 * "the null slot" and every guest cart created afterwards fails with
 * `Unique constraint failed on the constraint: Cart_userId_key` (HTTP 500 on
 * add-to-cart).
 *
 * THE FIX
 * Recreate the index as a *partial* unique index that only covers documents
 * whose `userId` is a string. Authenticated carts stay one-per-user; guest
 * carts fall outside the index entirely and no longer collide. Prisma's schema
 * language can't express a partial index, so it lives here.
 *
 * `@unique` must STAY in schema.prisma — seven call sites use
 * `cart.findUnique({ where: { userId } })`, which Prisma only permits on a
 * field marked unique. The attribute is what Prisma needs; the partial index
 * is what MongoDB enforces.
 *
 * WHY MONGOOSE AND NOT PRISMA
 * `prisma.$runCommandRaw()` reads `$`-prefixed keys as tagged values (`$oid`,
 * `$date`, …), so a `partialFilterExpression` containing `$type` fails with
 * "Unknown tagged value". Mongoose bundles the raw MongoDB driver, which has
 * no such restriction.
 *
 * USAGE
 *   $env:DATABASE_URL = "..."   # never paste this into a chat or shell history
 *   npm run fix:cart-index              # report only
 *   npm run fix:cart-index -- --apply   # repair
 *
 * Idempotent: re-running once the index is partial is a no-op. Safe to run if
 * a previous attempt died between the drop and the create — it will simply
 * create the missing index.
 *
 * CAVEAT: `prisma db push` would recreate this as a plain unique index and
 * reintroduce the bug. Re-run this script if that ever happens.
 */
import mongoose from 'mongoose';

const INDEX_NAME = 'Cart_userId_key';
const COLLECTION = 'Cart';

/** Only index carts whose userId is an actual string — excludes null AND missing. */
const PARTIAL_FILTER = { userId: { $type: 'string' } } as const;

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
  const carts = db.collection(COLLECTION);

  // ── Report current indexes ────────────────────────────────────────────────
  const indexes = await carts.indexes();
  console.log(`Indexes on "${COLLECTION}":`);
  for (const i of indexes) {
    const flags = [
      i.unique ? 'unique' : null,
      i.sparse ? 'sparse' : null,
      i.partialFilterExpression
        ? `partial=${JSON.stringify(i.partialFilterExpression)}`
        : null,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`  - ${i.name} ${JSON.stringify(i.key)} ${flags}`);
  }
  console.log();

  // ── Report cart shape. A MISSING field and an explicit null are different
  // values in MongoDB, and that distinction is the whole bug — so ask the
  // driver directly rather than going through Prisma's null semantics.
  const total = await carts.countDocuments({});
  const withString = await carts.countDocuments({ userId: { $type: 'string' } });
  const explicitNull = await carts.countDocuments({ userId: { $type: 'null' } });
  const missing = await carts.countDocuments({ userId: { $exists: false } });

  console.log('Carts by userId:');
  console.log(`  ${String(total).padStart(5)} total`);
  console.log(`  ${String(withString).padStart(5)} string  -> stay in the unique index (one cart per user)`);
  console.log(`  ${String(explicitNull).padStart(5)} null    -> guest carts, excluded by the partial index`);
  console.log(`  ${String(missing).padStart(5)} missing -> guest carts, excluded by the partial index\n`);

  // ── The partial index is unique over string userIds. If duplicates exist
  // (e.g. two carts were created for one user while the index was absent),
  // createIndex would fail. Surface them instead of failing cryptically.
  const dupes = await carts
    .aggregate<{ _id: string; n: number }>([
      { $match: { userId: { $type: 'string' } } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();

  if (dupes.length > 0) {
    console.error(`BLOCKED: ${dupes.length} user(s) have more than one cart:`);
    for (const d of dupes.slice(0, 10)) console.error(`  ${d._id}: ${d.n} carts`);
    console.error('\nA unique index cannot be created until these are merged or removed.');
    process.exit(1);
  }

  const existing = indexes.find((i) => i.name === INDEX_NAME);
  const isPartial =
    (existing?.partialFilterExpression as { userId?: { $type?: string } } | undefined)?.userId
      ?.$type === 'string';

  if (existing && isPartial) {
    console.log(`"${INDEX_NAME}" is ALREADY partial. Nothing to do — the bug is fixed.`);
    return;
  }

  if (!existing) {
    console.log(`"${INDEX_NAME}" is MISSING — userId uniqueness is not enforced right now.`);
    console.log('(Likely a previous run dropped it and failed before recreating.)\n');
  } else {
    console.log(`"${INDEX_NAME}" is a PLAIN unique index. This is the bug:`);
    console.log('  MongoDB counts a missing `userId` as a value, so only one guest');
    console.log('  cart can exist. Every later guest gets a 500 on add-to-cart.\n');
  }

  if (!apply) {
    console.log('Dry run — no changes made. Re-run with --apply to repair.');
    return;
  }

  if (existing) {
    console.log(`Dropping ${INDEX_NAME}...`);
    await carts.dropIndex(INDEX_NAME);
  }

  console.log(`Creating ${INDEX_NAME} as a partial unique index...`);
  await carts.createIndex(
    { userId: 1 },
    { name: INDEX_NAME, unique: true, partialFilterExpression: PARTIAL_FILTER },
  );

  const after = (await carts.indexes()).find((i) => i.name === INDEX_NAME);
  const afterPartial =
    (after?.partialFilterExpression as { userId?: { $type?: string } } | undefined)?.userId
      ?.$type === 'string';

  if (!after || !afterPartial || !after.unique) {
    console.error('\nVERIFICATION FAILED — index is not a partial unique index.');
    process.exit(1);
  }

  console.log('\nVerified:');
  console.log(
    `  ${after.name} ${JSON.stringify(after.key)} unique=${after.unique} partial=${JSON.stringify(after.partialFilterExpression)}`,
  );
  console.log('\nGuest carts can now be created. Authenticated carts remain one-per-user.');
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
