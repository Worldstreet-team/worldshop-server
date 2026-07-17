/**
 * Makes `prisma db push` succeed on a database with real data, despite two
 * optional-`@unique` fields that MongoDB cannot index as plain unique:
 *
 *   - UserProfile.storeSlug — every non-vendor profile is null/missing
 *   - Cart.userId           — every guest cart is null/missing
 *
 * MongoDB treats missing as null in unique indexes (only one null allowed),
 * and `db push` refuses to accept our partial-index workaround by name
 * (IndexKeySpecsConflict). So pushing takes three steps:
 *
 *   npm run db:push:prepare -- --apply   # 1. make the data plain-index-safe
 *   npx prisma@6.19.2 db push            # 2. apply the schema
 *   npm run db:push:finish  -- --apply   # 3. restore partial indexes + clean up
 *
 * prepare:
 *   - drops the partial UserProfile_storeSlug_key / Cart_userId_key if present
 *     (db push would conflict with them)
 *   - gives every profile without a storeSlug a unique placeholder
 *     (`__nostore__<id>`) so the plain unique index can build
 *   - deletes guest carts (carts with no userId — they are transient by
 *     design; signed-in carts are untouched)
 *   - reports any other null-duplicate risks it can't fix automatically
 *
 * finish:
 *   - recreates both indexes as partial unique (string values only)
 *   - removes the placeholder slugs
 *
 * Both steps are dry-run by default and idempotent — safe to re-run.
 * Run this trio again for any future `db push` against a populated database.
 */
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const PLACEHOLDER_PREFIX = '__nostore__';
const STORESLUG_INDEX = 'UserProfile_storeSlug_key';
const CART_INDEX = 'Cart_userId_key';

const mode = process.argv[2];
const apply = process.argv.includes('--apply');

function isPartial(index: { partialFilterExpression?: unknown } | undefined): boolean {
  return !!index?.partialFilterExpression;
}

async function main() {
  if (mode !== 'prepare' && mode !== 'finish') {
    console.error('Usage: ts-node scripts/db-push-helper.ts <prepare|finish> [--apply]');
    process.exit(1);
  }

  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  console.log(`Mode: ${mode.toUpperCase()} — ${apply ? 'APPLY' : 'DRY RUN (report only)'}\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connected but no database handle — check the URI has a db name');

  const profiles = db.collection('UserProfile');
  const carts = db.collection('Cart');
  const cartItems = db.collection('CartItem');

  if (mode === 'prepare') {
    // ── 1. Drop partial indexes that db push would conflict with ──────────
    for (const [coll, indexName] of [
      [profiles, STORESLUG_INDEX] as const,
      [carts, CART_INDEX] as const,
    ]) {
      const indexes = await coll.indexes().catch(() => []);
      const existing = indexes.find((i) => i.name === indexName);
      if (existing && isPartial(existing)) {
        console.log(`Partial index ${indexName} exists — ${apply ? 'dropping' : 'would drop'} (db push conflicts with it).`);
        if (apply) await coll.dropIndex(indexName);
      } else if (existing) {
        console.log(`${indexName} exists as a plain index — leaving it (db push will accept it).`);
      } else {
        console.log(`${indexName} not present — nothing to drop.`);
      }
    }
    console.log();

    // ── 2. Placeholder slugs for non-vendor profiles ──────────────────────
    const slugless = await profiles.countDocuments({ storeSlug: { $not: { $type: 'string' } } });
    console.log(`${slugless} profile(s) without a storeSlug ${apply ? 'get' : 'would get'} unique placeholders.`);
    if (apply && slugless > 0) {
      const res = await profiles.updateMany(
        { storeSlug: { $not: { $type: 'string' } } },
        [{ $set: { storeSlug: { $concat: [PLACEHOLDER_PREFIX, { $toString: '$_id' }] } } }],
      );
      console.log(`  -> ${res.modifiedCount} placeholder slug(s) set.`);
    }
    console.log();

    // ── 3. Guest carts would collide on Cart_userId_key — delete them ─────
    const guestCarts = await carts
      .find({ userId: { $not: { $type: 'string' } } }, { projection: { _id: 1 } })
      .toArray();
    console.log(`${guestCarts.length} guest cart(s) ${apply ? 'deleted' : 'would be deleted'} (transient; signed-in carts untouched).`);
    if (apply && guestCarts.length > 0) {
      const ids = guestCarts.map((c) => c._id);
      const items = await cartItems.deleteMany({ cartId: { $in: ids } });
      const removed = await carts.deleteMany({ _id: { $in: ids } });
      console.log(`  -> ${removed.deletedCount} cart(s) and ${items.deletedCount} cart item(s) removed.`);
    }
    console.log();

    // ── 4. Legacy payments (pre-checkout-session Paystack era) lack the
    // fields the Payment unique indexes cover. They are real, completed
    // history — keep them, but backfill permanent `__legacy__<id>` values so
    // the indexes can build. Nothing ever looks these records up by
    // session/ref, so the placeholders are inert.
    const payments = db.collection('Payment');
    for (const field of ['checkoutSessionId', 'transactionRef']) {
      const nullish = await payments.countDocuments({ [field]: { $not: { $type: 'string' } } });
      console.log(
        `${nullish} Payment document(s) lack ${field} — ${apply ? 'backfilling' : 'would backfill'} __legacy__ placeholders.`,
      );
      if (apply && nullish > 0) {
        const res = await payments.updateMany(
          { [field]: { $not: { $type: 'string' } } },
          [{ $set: { [field]: { $concat: ['__legacy__', { $toString: '$_id' }] } } }],
        );
        console.log(`  -> ${res.modifiedCount} backfilled.`);
      }
    }

    console.log(
      apply
        ? '\nPrepared. Now run: npx prisma@6.19.2 db push\nThen:            npm run db:push:finish -- --apply'
        : '\nDry run — no changes made. Re-run with --apply to prepare.',
    );
    return;
  }

  // ── finish ──────────────────────────────────────────────────────────────
  const jobs = [
    { coll: profiles, name: STORESLUG_INDEX, key: { storeSlug: 1 }, filter: { storeSlug: { $type: 'string' } } },
    { coll: carts, name: CART_INDEX, key: { userId: 1 }, filter: { userId: { $type: 'string' } } },
  ] as const;

  for (const job of jobs) {
    const indexes = await job.coll.indexes().catch(() => []);
    const existing = indexes.find((i) => i.name === job.name);
    if (existing && isPartial(existing)) {
      console.log(`${job.name} is already partial — nothing to do.`);
      continue;
    }
    console.log(`${job.name}: ${apply ? 'recreating' : 'would recreate'} as a partial unique index.`);
    if (apply) {
      if (existing) await job.coll.dropIndex(job.name);
      await job.coll.createIndex(job.key as Record<string, 1>, {
        name: job.name,
        unique: true,
        partialFilterExpression: job.filter as Record<string, unknown>,
      });
    }
  }
  console.log();

  const placeholders = await profiles.countDocuments({ storeSlug: { $regex: `^${PLACEHOLDER_PREFIX}` } });
  console.log(`${placeholders} placeholder slug(s) ${apply ? 'removed' : 'would be removed'}.`);
  if (apply && placeholders > 0) {
    const res = await profiles.updateMany(
      { storeSlug: { $regex: `^${PLACEHOLDER_PREFIX}` } },
      { $unset: { storeSlug: '' } },
    );
    console.log(`  -> ${res.modifiedCount} cleaned.`);
  }

  if (!apply) {
    console.log('\nDry run — no changes made. Re-run with --apply to finish.');
    return;
  }

  // Verify
  for (const job of jobs) {
    const after = (await job.coll.indexes()).find((i) => i.name === job.name);
    if (!after || !after.unique || !isPartial(after)) {
      console.error(`\nVERIFICATION FAILED — ${job.name} is not a partial unique index.`);
      process.exit(1);
    }
  }
  console.log('\nVerified: both indexes are partial unique, placeholders removed. Done.');
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
