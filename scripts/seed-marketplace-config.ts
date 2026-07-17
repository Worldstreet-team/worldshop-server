/**
 * Additive-only seeding of marketplace configuration:
 *
 *   - CategoryAttribute rows (listing standards per category, keyed by slug)
 *   - DeliveryPartner + ShippingMethod rows (delivery estimates at checkout)
 *
 * Unlike `prisma/seed.ts` (which WIPES products and categories — never run it
 * against a database with real data), this script only inserts what is
 * missing. Existing rows with the same identity are left untouched, so it is
 * safe to run repeatedly and safe on production.
 *
 * USAGE
 *   npm run seed:config              # report what would be created
 *   npm run seed:config -- --apply   # create it
 */
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';

dns.setServers(['1.1.1.1', '8.8.8.8']);

const apply = process.argv.includes('--apply');

// ── Listing standards per category slug ───────────────────────────────────
const ATTRIBUTES_BY_SLUG: Record<
  string,
  Array<{
    name: string;
    type: 'SELECT' | 'TEXT' | 'NUMBER';
    options: string[];
    isRequired: boolean;
    appliesTo: 'PRODUCT' | 'VARIANT';
    sortOrder: number;
  }>
> = {
  fashion: [
    { name: 'Size', type: 'SELECT', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '37', '38', '39', '40', '41', '42', '43', '44', '45'], isRequired: true, appliesTo: 'VARIANT', sortOrder: 1 },
    { name: 'Color', type: 'SELECT', options: ['Black', 'White', 'Navy', 'Grey', 'Red', 'Green', 'Blue', 'Pink', 'Brown', 'Beige'], isRequired: true, appliesTo: 'VARIANT', sortOrder: 2 },
    { name: 'Material', type: 'TEXT', options: [], isRequired: false, appliesTo: 'PRODUCT', sortOrder: 3 },
  ],
  electronics: [
    { name: 'Color', type: 'SELECT', options: ['Black', 'White', 'Silver', 'Grey', 'Gold', 'Rose Gold', 'Blue'], isRequired: false, appliesTo: 'VARIANT', sortOrder: 1 },
    { name: 'Storage', type: 'SELECT', options: ['64GB', '128GB', '256GB', '512GB', '1TB'], isRequired: false, appliesTo: 'VARIANT', sortOrder: 2 },
  ],
  'home-garden': [
    { name: 'Color', type: 'SELECT', options: ['Black', 'White', 'Natural', 'Walnut', 'Oak', 'Grey'], isRequired: false, appliesTo: 'VARIANT', sortOrder: 1 },
    { name: 'Material', type: 'TEXT', options: [], isRequired: false, appliesTo: 'PRODUCT', sortOrder: 2 },
  ],
  'sports-outdoors': [
    { name: 'Size', type: 'SELECT', options: ['XS', 'S', 'M', 'L', 'XL'], isRequired: false, appliesTo: 'VARIANT', sortOrder: 1 },
    { name: 'Color', type: 'SELECT', options: ['Black', 'Blue', 'Green', 'Pink', 'Orange', 'Purple'], isRequired: false, appliesTo: 'VARIANT', sortOrder: 2 },
  ],
  // digital-products / healthy: no physical listing standards
};

// ── Delivery partners & methods ───────────────────────────────────────────
const PARTNERS: Array<{
  name: string;
  trackingUrlTemplate: string;
  sortOrder: number;
  methods: Array<{ name: string; price: number; freeAbove?: number; minDays: number; maxDays: number; sortOrder: number }>;
}> = [
  {
    name: 'GIG Logistics',
    trackingUrlTemplate: 'https://giglogistics.com/tracking?waybill={tracking}',
    sortOrder: 1,
    methods: [
      { name: 'Standard Delivery', price: 2500, freeAbove: 50000, minDays: 3, maxDays: 5, sortOrder: 1 },
      { name: 'Express Delivery', price: 6000, minDays: 1, maxDays: 2, sortOrder: 2 },
    ],
  },
  {
    name: 'DHL Express',
    trackingUrlTemplate: 'https://www.dhl.com/ng-en/home/tracking.html?tracking-id={tracking}',
    sortOrder: 2,
    methods: [{ name: 'DHL Express', price: 12000, minDays: 1, maxDays: 2, sortOrder: 3 }],
  },
];

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error('DATABASE_URL is not set. Refusing to run.');
    process.exit(1);
  }

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (report only)'}\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('Connected but no database handle — check the URI has a db name');

  const now = new Date();

  // ── Category attributes ───────────────────────────────────────────────
  const categories = await db
    .collection('Category')
    .find({}, { projection: { name: 1, slug: 1 } })
    .toArray();
  const attrColl = db.collection('CategoryAttribute');

  for (const category of categories) {
    const wanted = ATTRIBUTES_BY_SLUG[category.slug as string];
    if (!wanted) {
      console.log(`Category "${category.name}" (${category.slug}): no listing standards defined — skipped.`);
      continue;
    }
    for (const attr of wanted) {
      const exists = await attrColl.findOne({ categoryId: category._id, name: attr.name });
      if (exists) {
        console.log(`Category "${category.name}": attribute "${attr.name}" already exists — left untouched.`);
        continue;
      }
      console.log(
        `Category "${category.name}": ${apply ? 'creating' : 'would create'} "${attr.name}" (${attr.type}${attr.isRequired ? ', required' : ''}, ${attr.appliesTo})`,
      );
      if (apply) {
        await attrColl.insertOne({
          categoryId: category._id,
          ...attr,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }
  console.log();

  // ── Delivery partners & shipping methods ──────────────────────────────
  const partnerColl = db.collection('DeliveryPartner');
  const methodColl = db.collection('ShippingMethod');

  for (const partner of PARTNERS) {
    const partnerDoc = await partnerColl.findOne({ name: partner.name });
    let partnerId = partnerDoc?._id ?? null;
    if (partnerDoc) {
      console.log(`Partner "${partner.name}" already exists — left untouched.`);
    } else {
      console.log(`${apply ? 'Creating' : 'Would create'} partner "${partner.name}".`);
      if (apply) {
        const res = await partnerColl.insertOne({
          name: partner.name,
          logo: null,
          trackingUrlTemplate: partner.trackingUrlTemplate,
          isActive: true,
          sortOrder: partner.sortOrder,
          createdAt: now,
          updatedAt: now,
        });
        partnerId = res.insertedId;
      }
    }

    for (const method of partner.methods) {
      if (!partnerId) {
        console.log(`  Would create method "${method.name}" — ₦${method.price}${method.freeAbove ? ` (free over ₦${method.freeAbove})` : ''}, ${method.minDays}–${method.maxDays} days`);
        continue; // dry run without partner id
      }
      const exists = await methodColl.findOne({ partnerId, name: method.name });
      if (exists) {
        console.log(`  Method "${method.name}" already exists — left untouched.`);
        continue;
      }
      console.log(
        `  ${apply ? 'Creating' : 'Would create'} method "${method.name}" — ₦${method.price}${method.freeAbove ? ` (free over ₦${method.freeAbove})` : ''}, ${method.minDays}–${method.maxDays} days`,
      );
      if (apply) {
        await methodColl.insertOne({
          partnerId,
          name: method.name,
          price: method.price,
          freeAbove: method.freeAbove ?? null,
          minDays: method.minDays,
          maxDays: method.maxDays,
          isActive: true,
          sortOrder: method.sortOrder,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  console.log(apply ? '\nDone.' : '\nDry run — no changes made. Re-run with --apply to create.');
}

main()
  .catch((err) => {
    console.error('\nFAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
