/**
 * Staged teardown for the ecommerce -> advertising-marketplace rebrand.
 *
 * The shop currently models on-platform selling (carts, orders, payments,
 * vendor payouts). The new model is a paid listings directory: vendors pay a
 * subscription to stay visible, buyers contact them off-platform. This script
 * removes the on-platform-selling data in dependency order, one phase at a
 * time, so each step can be reviewed before the next.
 *
 *   npm run teardown -- export                      # 1. back everything up
 *   npm run teardown -- checkout                    # 2. dry-run a phase
 *   npm run teardown -- checkout --apply            # 3. actually delete
 *
 * Every phase is DRY-RUN by default and idempotent — re-running a completed
 * phase deletes nothing. `--apply` is the only thing that writes.
 *
 * PHASES (run in this order — later phases assume earlier ones ran):
 *   export     Dump all 24 collections to backups/<timestamp>/ as EJSON.
 *              Not destructive. Required before `orders` and `financial`.
 *   checkout   Cart, CartItem, Wishlist, WishlistItem, DigitalAsset,
 *              DownloadRecord, Review — transient checkout-flow artifacts
 *              with no meaning in a listings marketplace.
 *   orders     Order, OrderItem, OrderStatusHistory, Payment, LedgerEntry —
 *              real financial history. Refuses to run without a backup.
 *   financial  VendorBalance, VendorWithdrawalAccount, VendorWithdrawalRequest.
 *              These represent money OWED TO VENDORS. Refuses to run without
 *              both a backup and --balances-settled.
 *   delivery   DeliveryPartner, ShippingMethod — nothing ships any more.
 *   catalog    Product, ProductVariant, Category, CategoryAttribute.
 *              Destructive and hard to rebuild: 213 listings vendors uploaded
 *              themselves. Prefer migrating these (see the schema diff doc)
 *              unless you have decided to start the catalog from zero.
 *   stores     Clears the vendor fields on UserProfile (isVendor,
 *              vendorStatus, storeName, storeSlug, storeDescription,
 *              vendorSince). Does NOT delete profiles — identity lives in the
 *              `user-account` database, which other WorldStreet apps share.
 *
 * NEVER touched by any phase: UserProfile documents themselves, Address,
 * PlatformConfig, Task.
 *
 * Safety rails:
 *   - dry-run unless --apply
 *   - refuses to run against a database other than `goldstreetshop` unless
 *     --db=<name> names it explicitly
 *   - `orders` and `financial` refuse to delete anything that isn't already
 *     present in a backup directory
 */
import 'dotenv/config';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { EJSON } from 'bson';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const DEFAULT_DB = 'goldstreetshop';
const BACKUP_ROOT = path.resolve(__dirname, '..', 'backups');

/**
 * Collections the schema is known to define, used only to warn about drift.
 *
 * `export` does NOT iterate this list — it reads the database's own collection
 * list, because a hardcoded array silently stops being a full backup the moment
 * a model is added. This one had gone stale exactly that way: it predated
 * Store, Subscription, Conversation and the rest, so a "full export" was
 * omitting every pivot model.
 */
const KNOWN_COLLECTIONS = [
  'Address', 'Cart', 'CartItem', 'Category', 'CategoryAttribute',
  'Conversation', 'DeliveryPartner', 'DigitalAsset', 'DownloadRecord',
  'LedgerEntry', 'Message', 'Order', 'OrderItem', 'OrderStatusHistory',
  'Payment', 'PlatformConfig', 'Product', 'ProductVariant', 'Report', 'Review',
  'ShippingMethod', 'Store', 'StoreCreditEntry', 'Subscription',
  'SubscriptionCharge', 'SubscriptionPlan', 'Task', 'UserProfile',
  'VendorBalance', 'VendorWithdrawalAccount', 'VendorWithdrawalRequest',
  'Wishlist', 'WishlistItem',
];

type Phase = {
  name: string;
  description: string;
  collections?: string[];
  requiresBackup?: boolean;
  requiresFlag?: { flag: string; because: string };
};

const PHASES: Phase[] = [
  {
    name: 'checkout',
    description: 'Checkout-flow artifacts with no meaning in a listings marketplace',
    collections: ['CartItem', 'Cart', 'WishlistItem', 'Wishlist', 'DownloadRecord', 'DigitalAsset', 'Review'],
  },
  {
    name: 'orders',
    description: 'Order and payment history (financial records — exported first)',
    collections: ['OrderStatusHistory', 'OrderItem', 'Order', 'Payment', 'LedgerEntry'],
    requiresBackup: true,
  },
  {
    name: 'financial',
    description: 'Vendor balances and payout accounts (money owed to real people)',
    collections: ['VendorWithdrawalRequest', 'VendorWithdrawalAccount', 'VendorBalance'],
    requiresBackup: true,
    requiresFlag: {
      flag: '--balances-settled',
      because: 'these rows are liabilities: 5 vendor balances and 17 payout accounts. Pay out or migrate them to subscription credit before deleting.',
    },
  },
  {
    name: 'delivery',
    description: 'Delivery partners and shipping methods (nothing ships any more)',
    collections: ['ShippingMethod', 'DeliveryPartner'],
  },
  {
    name: 'listings',
    description: 'Pre-pivot products and variants (keeps the category taxonomy)',
    collections: ['ProductVariant', 'Product'],
    requiresBackup: true,
    requiresFlag: {
      flag: '--drop-listings',
      because: 'vendors lose their catalogues and re-upload from scratch. Only do this if they are starting fresh.',
    },
  },
  {
    // Separate from `listings` because the taxonomy is now seeded and curated —
    // wiping it would delete 95 categories and 230 attributes that nothing else
    // can rebuild except re-running seed:taxonomy.
    name: 'catalog',
    description: 'The category taxonomy itself — categories and attributes',
    collections: ['CategoryAttribute', 'Category'],
    requiresBackup: true,
    requiresFlag: {
      flag: '--drop-taxonomy',
      because: 'this deletes the seeded taxonomy (95 categories, 230 attributes). Re-runnable via `npm run seed:taxonomy`, but every listing filed against a category loses it.',
    },
  },
  {
    name: 'stores',
    description: 'Clear vendor/store fields on UserProfile (profiles themselves are kept)',
  },
];

const VENDOR_FIELDS = ['vendorStatus', 'storeName', 'storeSlug', 'storeDescription', 'vendorSince'];

const args = process.argv.slice(2);
const phaseName = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const flag = (name: string) => args.includes(name);
const dbOverride = args.find((a) => a.startsWith('--db='))?.split('=')[1];

function usage(): never {
  console.error('Usage: ts-node scripts/marketplace-teardown.ts <phase> [--apply] [--db=<name>]');
  console.error('Phases: export, ' + PHASES.map((p) => p.name).join(', ') + ', status');
  process.exit(1);
}

/** Most recent backups/<timestamp>/ directory, or null if none exists. */
function latestBackup(): string | null {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const dirs = fs.readdirSync(BACKUP_ROOT)
    .filter((d) => fs.statSync(path.join(BACKUP_ROOT, d)).isDirectory())
    .sort();
  return dirs.length ? path.join(BACKUP_ROOT, dirs[dirs.length - 1]) : null;
}

/** A collection counts as backed up when a non-empty dump of it exists. */
function backedUp(backupDir: string | null, collection: string): boolean {
  if (!backupDir) return false;
  const file = path.join(backupDir, `${collection}.json`);
  if (!fs.existsSync(file)) return false;
  return fs.statSync(file).size > 0;
}

async function runExport(db: mongoose.mongo.Db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_ROOT, stamp);

  // Read what is actually there rather than what this file thinks is there.
  const present = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  const unknown = present.filter((n) => !KNOWN_COLLECTIONS.includes(n));
  if (unknown.length) {
    console.log(`Note: exporting ${unknown.length} collection(s) not in the known list: ${unknown.join(', ')}\n`);
  }
  const missing = KNOWN_COLLECTIONS.filter((n) => !present.includes(n));
  if (missing.length) {
    console.log(`Note: ${missing.length} known collection(s) do not exist yet: ${missing.join(', ')}\n`);
  }

  if (!apply) {
    console.log(`DRY RUN — would write ${present.length} files to ${dir}\n`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }

  let total = 0;
  for (const name of present) {
    const docs = await db.collection(name).find({}).toArray();
    total += docs.length;
    if (apply) {
      fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, undefined, 2));
    }
    console.log(`  ${name.padEnd(26)} ${String(docs.length).padStart(5)} docs`);
  }

  console.log(`\n${apply ? 'Wrote' : 'Would write'} ${total} documents.`);
  if (apply) console.log(`Backup: ${dir}`);
  else console.log('Re-run with --apply to write the backup.');
}

async function runStatus(db: mongoose.mongo.Db) {
  const backup = latestBackup();
  console.log(`Latest backup: ${backup ?? 'NONE'}\n`);

  for (const phase of PHASES) {
    const counts: string[] = [];
    let remaining = 0;

    if (phase.collections) {
      for (const name of phase.collections) {
        const n = await db.collection(name).countDocuments();
        remaining += n;
        counts.push(`${name}=${n}`);
      }
    } else {
      remaining = await db.collection('UserProfile').countDocuments({ isVendor: true });
      counts.push(`UserProfile(isVendor)=${remaining}`);
    }

    const state = remaining === 0 ? 'done' : 'pending';
    console.log(`  ${phase.name.padEnd(10)} ${state.padEnd(8)} ${counts.join('  ')}`);
  }
}

async function runStores(db: mongoose.mongo.Db) {
  const col = db.collection('UserProfile');
  const filter = {
    $or: [
      { isVendor: true },
      ...VENDOR_FIELDS.map((f) => ({ [f]: { $exists: true, $ne: null } })),
    ],
  };

  const affected = await col.countDocuments(filter);
  console.log(`  UserProfile documents with vendor/store data: ${affected}`);
  console.log(`  Fields cleared: isVendor -> false, ${VENDOR_FIELDS.join(', ')} -> unset`);
  console.log('  Profiles themselves are NOT deleted.');

  if (!apply) return affected;

  const result = await col.updateMany(filter, {
    $set: { isVendor: false, updatedAt: new Date() },
    $unset: Object.fromEntries(VENDOR_FIELDS.map((f) => [f, ''])),
  });
  console.log(`\n  Modified ${result.modifiedCount} profiles.`);

  // storeSlug is backed by a PARTIAL unique index (see db-push-helper.ts).
  // Unsetting the field is compatible with it, but the index is worth keeping
  // in mind if the new schema renames or re-homes the slug.
  console.log('  NOTE: the partial unique index UserProfile_storeSlug_key still exists.');
  return affected;
}

async function runPhase(db: mongoose.mongo.Db, phase: Phase) {
  if (phase.requiresFlag && !flag(phase.requiresFlag.flag)) {
    console.error(`Refusing to run "${phase.name}" without ${phase.requiresFlag.flag}.`);
    console.error(`Reason: ${phase.requiresFlag.because}`);
    process.exit(1);
  }

  if (phase.requiresBackup) {
    const backup = latestBackup();
    const missing = (phase.collections ?? []).filter((c) => !backedUp(backup, c));
    if (missing.length) {
      console.error(`Refusing to run "${phase.name}" — no backup found for: ${missing.join(', ')}`);
      console.error('Run `npm run teardown -- export --apply` first.');
      process.exit(1);
    }
    console.log(`Backup verified: ${backup}\n`);
  }

  console.log(`Phase "${phase.name}" — ${phase.description}`);
  console.log(apply ? 'APPLYING\n' : 'DRY RUN (re-run with --apply to delete)\n');

  if (!phase.collections) {
    await runStores(db);
    return;
  }

  let total = 0;
  for (const name of phase.collections) {
    const n = await db.collection(name).countDocuments();
    total += n;
    if (apply && n > 0) {
      const result = await db.collection(name).deleteMany({});
      console.log(`  ${name.padEnd(26)} deleted ${result.deletedCount}`);
    } else {
      console.log(`  ${name.padEnd(26)} ${n} docs${n ? '' : ' (already empty)'}`);
    }
  }

  console.log(`\n${apply ? 'Deleted' : 'Would delete'} ${total} documents.`);
}

async function main() {
  if (!phaseName) usage();

  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect.');

  const expected = dbOverride ?? DEFAULT_DB;
  if (db.databaseName !== expected) {
    console.error(`Connected to "${db.databaseName}" but expected "${expected}".`);
    console.error('Pass --db=<name> to confirm you meant this database.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Database: ${db.databaseName}\n`);

  try {
    if (phaseName === 'export') {
      await runExport(db);
    } else if (phaseName === 'status') {
      await runStatus(db);
    } else {
      const phase = PHASES.find((p) => p.name === phaseName);
      if (!phase) usage();
      await runPhase(db, phase);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
