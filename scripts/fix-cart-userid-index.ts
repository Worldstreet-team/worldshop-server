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
 * USAGE
 *   DATABASE_URL="mongodb+srv://..." npx ts-node scripts/fix-cart-userid-index.ts
 *   DATABASE_URL="mongodb+srv://..." npx ts-node scripts/fix-cart-userid-index.ts --apply
 *
 * Without `--apply` it only reports. It is idempotent: re-running once the
 * index is already partial is a no-op.
 *
 * CAVEAT: `prisma db push` would recreate this as a plain unique index and
 * reintroduce the bug. Re-run this script if that ever happens.
 */
import { PrismaClient } from '../generated/prisma';

const INDEX_NAME = 'Cart_userId_key';
const COLLECTION = 'Cart';

/** Only index carts whose userId is an actual string — excludes null AND missing. */
const PARTIAL_FILTER = { userId: { $type: 'string' } };

type MongoIndex = {
  name: string;
  key: Record<string, number>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function listIndexes(): Promise<MongoIndex[]> {
  const res = (await prisma.$runCommandRaw({ listIndexes: COLLECTION })) as unknown as {
    cursor?: { firstBatch?: MongoIndex[] };
  };
  return res.cursor?.firstBatch ?? [];
}

function isAlreadyPartial(idx: MongoIndex): boolean {
  const pfe = idx.partialFilterExpression as
    | { userId?: { $type?: string } }
    | undefined;
  return pfe?.userId?.$type === 'string';
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  console.log(`Mode: ${apply ? 'APPLY (will modify indexes)' : 'DRY RUN (report only)'}\n`);

  const before = await listIndexes();
  const target = before.find((i) => i.name === INDEX_NAME);

  console.log(`Indexes on "${COLLECTION}":`);
  for (const i of before) {
    const flags = [
      i.unique ? 'unique' : null,
      i.sparse ? 'sparse' : null,
      i.partialFilterExpression ? `partial=${JSON.stringify(i.partialFilterExpression)}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`  - ${i.name} ${JSON.stringify(i.key)} ${flags}`);
  }
  console.log();

  // How many carts would the partial index exclude? (i.e. guest carts)
  const guestCarts = await prisma.cart.count({ where: { userId: null } });
  const totalCarts = await prisma.cart.count();
  console.log(`Carts: ${totalCarts} total, ${guestCarts} guest (userId null/missing)\n`);

  if (!target) {
    console.log(`No "${INDEX_NAME}" index found — nothing to repair.`);
    console.log('(If guest add-to-cart still 500s, the cause is elsewhere.)');
    return;
  }

  if (isAlreadyPartial(target)) {
    console.log(`"${INDEX_NAME}" is ALREADY partial. Nothing to do — the bug is fixed.`);
    return;
  }

  console.log(`"${INDEX_NAME}" is a PLAIN unique index. This is the bug:`);
  console.log('  MongoDB counts a missing `userId` as a value, so only one guest');
  console.log('  cart can exist. Every later guest gets a 500 on add-to-cart.\n');

  if (!apply) {
    console.log('Dry run — no changes made. Re-run with --apply to repair:');
    console.log(`  1. drop   ${INDEX_NAME}`);
    console.log(`  2. create ${INDEX_NAME} as unique + partialFilterExpression ${JSON.stringify(PARTIAL_FILTER)}`);
    return;
  }

  // Authenticated carts are unique on userId today (the plain index enforced
  // it), so recreating cannot fail on existing data. There is a sub-second
  // window between drop and create where a duplicate authed cart could be
  // inserted; the create would then fail loudly and leave the index absent,
  // so re-run the script if that happens.
  console.log(`Dropping ${INDEX_NAME}...`);
  await prisma.$runCommandRaw({ dropIndexes: COLLECTION, index: INDEX_NAME });

  console.log(`Creating ${INDEX_NAME} as a partial unique index...`);
  await prisma.$runCommandRaw({
    createIndexes: COLLECTION,
    indexes: [
      {
        key: { userId: 1 },
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: PARTIAL_FILTER,
      },
    ],
  });

  const after = (await listIndexes()).find((i) => i.name === INDEX_NAME);
  if (!after || !isAlreadyPartial(after)) {
    console.error('\nVERIFICATION FAILED — index is not partial. Investigate before deploying.');
    process.exit(1);
  }

  console.log('\nVerified:');
  console.log(`  ${after.name} ${JSON.stringify(after.key)} unique=${after.unique} partial=${JSON.stringify(after.partialFilterExpression)}`);
  console.log('\nGuest carts can now be created. Authenticated carts remain one-per-user.');
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
