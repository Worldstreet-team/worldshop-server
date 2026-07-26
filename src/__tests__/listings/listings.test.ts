import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as listingService from '../../services/listing.service';

const PREFIX = 'listtest-';
const SLUG = 'listtest';

let parentCategoryId: string;
let leafCategoryId: string;

async function cleanupCategories() {
  const cats = await prisma.category.findMany({
    where: { slug: { startsWith: SLUG } },
    select: { id: true },
  });
  const ids = cats.map((c) => c.id);
  if (ids.length) {
    await prisma.categoryAttribute.deleteMany({ where: { categoryId: { in: ids } } });
    // Children first — the tree relation is NoAction, not cascade.
    await prisma.category.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
  }
}

async function cleanupStores() {
  const stores = await prisma.store.findMany({
    where: { ownerId: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = stores.map((s) => s.id);
  if (ids.length) {
    const products = await prisma.product.findMany({ where: { storeId: { in: ids } }, select: { id: true } });
    const pids = products.map((p) => p.id);
    if (pids.length) {
      await prisma.productVariant.deleteMany({ where: { productId: { in: pids } } });
      await prisma.product.deleteMany({ where: { id: { in: pids } } });
    }
    await prisma.subscription.deleteMany({ where: { storeId: { in: ids } } });
    await prisma.store.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
}

/** A store at a chosen subscription status, with no real payment involved. */
async function makeStore(name: string, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') {
  const ownerId = `${PREFIX}${name}`;
  await createTestUser({ userId: ownerId });
  return prisma.store.create({
    data: {
      ownerId,
      name: `${name} Store`,
      slug: `${SLUG}-${name}`,
      state: 'Lagos',
      city: 'Ikeja',
      status,
    },
    select: { id: true, status: true, state: true, city: true, slug: true },
  });
}

const baseListing = {
  name: 'Ankara Two-Piece Set',
  description: 'Hand-sewn Ankara two-piece with adjustable waist, made to order in Lagos.',
  priceType: 'FIXED' as const,
  basePrice: 25000,
  isNegotiable: true,
  tags: [],
  images: [{ key: 'listtest/one.jpg', isPrimary: true }],
  customFields: [],
  variants: [],
};

describe('vendor listings', () => {
  beforeAll(async () => {
    await cleanupStores();
    await cleanupCategories();

    const parent = await prisma.category.create({
      data: { name: 'Listtest Fashion', slug: `${SLUG}-fashion` },
    });
    parentCategoryId = parent.id;

    const leaf = await prisma.category.create({
      data: { name: 'Listtest Dresses', slug: `${SLUG}-dresses`, parentId: parent.id },
    });
    leafCategoryId = leaf.id;

    await prisma.categoryAttribute.createMany({
      data: [
        {
          categoryId: leaf.id,
          name: 'Condition',
          type: 'SELECT',
          options: ['New', 'Used'],
          isRequired: true,
          appliesTo: 'PRODUCT',
        },
        {
          categoryId: leaf.id,
          name: 'Fabric',
          type: 'TEXT',
          options: [],
          isRequired: false,
          appliesTo: 'PRODUCT',
          isFilterable: false,
        },
      ],
    });
  });

  afterEach(cleanupStores);
  afterAll(cleanupCategories);

  it('creates listings as DRAFT, never public', async () => {
    const store = await makeStore('draft', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });

    expect(listing.status).toBe('DRAFT');

    const { total } = await listingService.listPublicListings({ page: 1, limit: 20 });
    const mine = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Ankara' });
    expect(mine.listings.find((l) => l.id === listing.id)).toBeUndefined();
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('refuses a top-level category — listings attach to leaves', async () => {
    const store = await makeStore('parentcat');
    await expect(
      listingService.createListing(store, { ...baseListing, categoryId: parentCategoryId }),
    ).rejects.toThrow(/top-level category/i);
  });

  it('refuses to publish a listing sitting on a parent category', async () => {
    const store = await makeStore('publishparent', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });

    // Reproduces a pre-pivot listing whose flat category later gained children,
    // which create/update guards never see.
    await prisma.product.update({
      where: { id: listing.id },
      data: { categoryId: parentCategoryId },
    });

    await expect(listingService.publishListing(store, listing.id)).rejects.toThrow(
      /top-level category/i,
    );
  });

  it('rejects attribute names the category does not define', async () => {
    const store = await makeStore('unknownattr');
    await expect(
      listingService.createListing(store, {
        ...baseListing,
        categoryId: leafCategoryId,
        attributes: { Condition: 'New', Horsepower: '400' },
      }),
    ).rejects.toThrow(/no attribute named "Horsepower"/i);
  });

  it('rejects an attribute value outside the allowed options', async () => {
    const store = await makeStore('badvalue', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'Slightly battered' },
    });

    await expect(listingService.publishListing(store, listing.id)).rejects.toThrow(
      /not a valid Condition/i,
    );
  });

  it('blocks publishing until a required attribute is filled', async () => {
    const store = await makeStore('missingattr', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
    });

    await expect(listingService.publishListing(store, listing.id)).rejects.toThrow(
      /Condition is required/i,
    );
  });

  it('stores unlimited custom fields alongside structured attributes', async () => {
    const store = await makeStore('customfields', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New', Fabric: 'Ankara cotton' },
      customFields: [
        { label: 'Made to order', value: '5 working days' },
        { label: 'Care', value: 'Hand wash cold' },
      ],
    });

    expect(listing.attributes).toEqual({ Condition: 'New', Fabric: 'Ankara cotton' });
    expect(listing.customFields).toEqual([
      { label: 'Made to order', value: '5 working days', sortOrder: 0 },
      { label: 'Care', value: 'Hand wash cold', sortOrder: 1 },
    ]);
  });

  it('publishes on a paid store and appears in public browse', async () => {
    const store = await makeStore('live', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });

    const result = await listingService.publishListing(store, listing.id);
    expect(result.publiclyVisible).toBe(true);

    const { listings } = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Ankara' });
    expect(listings.map((l) => l.id)).toContain(listing.id);
  });

  it('lets an unpaid store publish, but keeps it out of public browse', async () => {
    const store = await makeStore('unpaid', 'DRAFT');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });

    const result = await listingService.publishListing(store, listing.id);

    expect(result.listing.status).toBe('PUBLISHED');
    expect(result.publiclyVisible).toBe(false);
    expect(result.message).toMatch(/as soon as your subscription is active/i);

    const { listings } = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Ankara' });
    expect(listings.map((l) => l.id)).not.toContain(listing.id);
  });

  it('reveals the whole catalogue the moment the store is paid', async () => {
    const store = await makeStore('reveal', 'DRAFT');
    for (const n of ['One', 'Two', 'Three']) {
      const l = await listingService.createListing(store, {
        ...baseListing,
        name: `Reveal ${n} Ankara`,
        categoryId: leafCategoryId,
        attributes: { Condition: 'New' },
      });
      await listingService.publishListing(store, l.id);
    }

    let visible = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Reveal' });
    expect(visible.total).toBe(0);

    // Exactly what a successful subscription charge does.
    await prisma.store.update({ where: { id: store.id }, data: { status: 'ACTIVE' } });

    visible = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Reveal' });
    expect(visible.total).toBe(3);
  });

  it('filters on structured attributes', async () => {
    const store = await makeStore('facets', 'ACTIVE');
    for (const condition of ['New', 'Used']) {
      const l = await listingService.createListing(store, {
        ...baseListing,
        name: `Facet ${condition} Ankara`,
        categoryId: leafCategoryId,
        attributes: { Condition: condition },
      });
      await listingService.publishListing(store, l.id);
    }

    const used = await listingService.listPublicListings({
      page: 1,
      limit: 50,
      search: 'Facet',
      attributes: { Condition: 'Used' },
    });

    expect(used.total).toBe(1);
    expect(used.listings[0].name).toContain('Used');
  });

  it('keeps variants with their own price and photos', async () => {
    const store = await makeStore('variants', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
      variants: [
        { name: 'Small / Red', attributes: { Size: 'S', Colour: 'Red' }, price: 25000, images: [{ key: 'v/red.jpg' }] },
        { name: 'Large / Blue', attributes: { Size: 'L', Colour: 'Blue' }, price: 27000, isAvailable: false },
      ],
    });

    expect(listing.variants).toHaveLength(2);
    expect(listing.variants[0].images).toEqual([{ key: 'v/red.jpg' }]);
    expect(listing.variants[1].isAvailable).toBe(false);
  });

  it('unpublishing removes it from browse but keeps the listing', async () => {
    const store = await makeStore('hide', 'ACTIVE');
    const listing = await listingService.createListing(store, {
      ...baseListing,
      name: 'Hideme Ankara',
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });
    await listingService.publishListing(store, listing.id);
    await listingService.unpublishListing(store.id, listing.id);

    const { total } = await listingService.listPublicListings({ page: 1, limit: 50, search: 'Hideme' });
    expect(total).toBe(0);
    expect(await listingService.getMyListing(store.id, listing.id)).not.toBeNull();
  });

  it('exposes a form spec so the vendor UI can render category fields', async () => {
    const spec = await listingService.getCategoryFormSpec(leafCategoryId);

    expect(spec.attributes).toHaveLength(2);
    const condition = spec.attributes.find((a) => a.name === 'Condition');
    expect(condition).toMatchObject({ isRequired: true, isFilterable: true, options: ['New', 'Used'] });
    const fabric = spec.attributes.find((a) => a.name === 'Fabric');
    expect(fabric).toMatchObject({ isRequired: false, isFilterable: false });
  });

  it('scopes listings to their own store', async () => {
    const mine = await makeStore('owner', 'ACTIVE');
    const theirs = await makeStore('intruder', 'ACTIVE');

    const listing = await listingService.createListing(mine, {
      ...baseListing,
      categoryId: leafCategoryId,
      attributes: { Condition: 'New' },
    });

    expect(await listingService.getMyListing(theirs.id, listing.id)).toBeNull();
    await expect(
      listingService.updateListing(theirs.id, listing.id, { name: 'Hijacked' }),
    ).rejects.toThrow(/not found/i);
  });
});
