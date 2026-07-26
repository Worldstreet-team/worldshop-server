import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import * as adminCategory from '../../services/admin.category.service';

const SLUG = 'admincat';

async function cleanup() {
  const cats = await prisma.category.findMany({
    where: { slug: { startsWith: SLUG } },
    select: { id: true },
  });
  const ids = cats.map((c) => c.id);
  if (!ids.length) return;

  await prisma.categoryAttribute.deleteMany({ where: { categoryId: { in: ids } } });
  await prisma.productVariant.deleteMany({ where: { product: { is: { categoryId: { in: ids } } } } });
  await prisma.product.deleteMany({ where: { categoryId: { in: ids } } });
  // Children first — the tree relation is NoAction, not cascade.
  await prisma.category.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { id: { in: ids } } });
}

const top = (name: string) => adminCategory.createCategory({
  name: `${SLUG} ${name}`,
  sortOrder: 0,
  isActive: true,
});

async function leaf(name: string, parentId: string) {
  return adminCategory.createCategory({
    name: `${SLUG} ${name}`,
    parentId,
    sortOrder: 0,
    isActive: true,
  });
}

/** A bare listing, enough to exercise the guards. */
async function listing(categoryId: string, attributes?: Record<string, unknown>) {
  return prisma.product.create({
    data: {
      name: `${SLUG} listing ${Math.random().toString(36).slice(2, 8)}`,
      slug: `${SLUG}-listing-${Math.random().toString(36).slice(2, 10)}`,
      description: 'Test listing for admin category guards',
      basePrice: 1000,
      categoryId,
      ...(attributes ? { attributes: attributes as never } : {}),
    },
  });
}

describe('admin category management', () => {
  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(cleanup);

  it('creates two levels', async () => {
    const parent = await top('Vehicles');
    const child = await leaf('Cars', parent.id);

    expect(parent.parentId).toBeNull();
    expect(child.parentId).toBe(parent.id);
  });

  it('refuses a third level', async () => {
    const parent = await top('Depth');
    const child = await leaf('Middle', parent.id);

    await expect(leaf('TooDeep', child.id)).rejects.toThrow(/two levels deep/i);
  });

  it('refuses to make a category with children into a subcategory', async () => {
    const parentA = await top('OwnsChildren');
    await leaf('SomeChild', parentA.id);
    const parentB = await top('OtherTop');

    await expect(
      adminCategory.updateCategory(parentA.id, { parentId: parentB.id }),
    ).rejects.toThrow(/cannot itself become a subcategory/i);
  });

  it('refuses to give a category children while listings are filed against it', async () => {
    const parent = await top('HasListings');
    await listing(parent.id);

    await expect(leaf('NewChild', parent.id)).rejects.toThrow(/Move them to a subcategory/i);
  });

  it('keeps the slug when renaming, unless asked', async () => {
    const parent = await top('Original Name');
    const originalSlug = parent.slug;

    const renamed = await adminCategory.updateCategory(parent.id, { name: `${SLUG} Corrected Name` });
    expect(renamed.slug).toBe(originalSlug);

    const reslugged = await adminCategory.updateCategory(parent.id, {
      name: `${SLUG} Corrected Name`,
      regenerateSlug: true,
    });
    expect(reslugged.slug).not.toBe(originalSlug);
  });

  it('deactivates children with their parent instead of orphaning them', async () => {
    const parent = await top('Sunset');
    const child = await leaf('SunsetChild', parent.id);
    await listing(child.id);

    const result = await adminCategory.deleteCategory(parent.id);

    expect(result.deactivatedChildren).toBe(1);
    expect(result.listingsNeedingRefile).toBe(1);

    const after = await prisma.category.findUnique({ where: { id: child.id } });
    // Detaching would silently promote it to a top-level heading.
    expect(after?.isActive).toBe(false);
    expect(after?.parentId).toBe(parent.id);
  });

  it('only moves listings to a leaf', async () => {
    const parent = await top('MoveFrom');
    const child = await leaf('MoveFromChild', parent.id);
    const otherTop = await top('MoveToTop');
    await leaf('MoveToLeaf', otherTop.id);
    await listing(child.id);

    await expect(adminCategory.deleteCategory(child.id, otherTop.id)).rejects.toThrow(
      /top-level category/i,
    );
  });

  it('puts attributes on leaves only', async () => {
    const parent = await top('AttrTop');
    const child = await leaf('AttrLeaf', parent.id);

    await expect(
      adminCategory.createAttribute(parent.id, {
        name: 'Size',
        type: 'SELECT',
        options: ['S', 'M'],
        isRequired: false,
        appliesTo: 'VARIANT',
        sortOrder: 0,
      }),
    ).rejects.toThrow(/Attributes belong on the subcategories/i);

    const attr = await adminCategory.createAttribute(child.id, {
      name: 'Size',
      type: 'SELECT',
      options: ['S', 'M'],
      isRequired: false,
      appliesTo: 'VARIANT',
      sortOrder: 0,
    });
    expect(attr.isFilterable).toBe(true);
  });

  it('rejects a duplicate attribute name case-insensitively', async () => {
    const parent = await top('DupTop');
    const child = await leaf('DupLeaf', parent.id);
    const base = { type: 'SELECT' as const, options: ['A'], isRequired: false, appliesTo: 'PRODUCT' as const, sortOrder: 0 };

    await adminCategory.createAttribute(child.id, { name: 'Colour', ...base });
    await expect(adminCategory.createAttribute(child.id, { name: 'colour', ...base })).rejects.toThrow(
      /already has an attribute named/i,
    );
  });

  it('makes non-SELECT attributes unfilterable', async () => {
    const parent = await top('TextTop');
    const child = await leaf('TextLeaf', parent.id);

    const attr = await adminCategory.createAttribute(child.id, {
      name: 'Fabric',
      type: 'TEXT',
      options: [],
      isRequired: false,
      appliesTo: 'PRODUCT',
      sortOrder: 0,
    });
    expect(attr.isFilterable).toBe(false);
  });

  it('reports how many listings an attribute change invalidates', async () => {
    const parent = await top('BlastTop');
    const child = await leaf('BlastLeaf', parent.id);
    const base = { type: 'SELECT' as const, options: ['New', 'Used', 'Refurbished'], isRequired: false, appliesTo: 'PRODUCT' as const, sortOrder: 0 };
    const attr = await adminCategory.createAttribute(child.id, { name: 'Grade', ...base });

    await listing(child.id, { Grade: 'Refurbished' });
    await listing(child.id, { Grade: 'New' });
    await listing(child.id); // no value at all

    // Dropping an option strands the listing that used it.
    const dropped = await adminCategory.updateAttribute(child.id, attr.id, {
      options: ['New', 'Used'],
    });
    expect(dropped.listingsNowInvalid).toBe(1);

    // Making it required additionally strands the one with no value.
    const required = await adminCategory.updateAttribute(child.id, attr.id, { isRequired: true });
    expect(required.listingsNowInvalid).toBe(2);
  });

  it('refuses to delete an attribute in use without force, then clears it', async () => {
    const parent = await top('DelTop');
    const child = await leaf('DelLeaf', parent.id);
    const attr = await adminCategory.createAttribute(child.id, {
      name: 'Warranty',
      type: 'SELECT',
      options: ['6 months', '1 year'],
      isRequired: false,
      appliesTo: 'PRODUCT',
      sortOrder: 0,
    });
    const used = await listing(child.id, { Warranty: '1 year' });

    await expect(adminCategory.deleteAttribute(child.id, attr.id)).rejects.toThrow(
      /Pass force=true/i,
    );

    const result = await adminCategory.deleteAttribute(child.id, attr.id, true);
    expect(result.listingsCleared).toBe(1);

    // The orphaned key must go, or the vendor's next edit is rejected for
    // referencing an attribute the category no longer defines.
    const after = await prisma.product.findUnique({ where: { id: used.id } });
    expect(after?.attributes).toEqual({});
  });

  it('reorders attributes and refuses ids from another category', async () => {
    const parent = await top('OrderTop');
    const child = await leaf('OrderLeaf', parent.id);
    const other = await leaf('OrderOther', parent.id);
    const base = { type: 'TEXT' as const, options: [], isRequired: false, appliesTo: 'PRODUCT' as const, sortOrder: 0 };

    const a = await adminCategory.createAttribute(child.id, { name: 'Alpha', ...base });
    const b = await adminCategory.createAttribute(child.id, { name: 'Beta', ...base });
    const foreign = await adminCategory.createAttribute(other.id, { name: 'Gamma', ...base });

    const ordered = await adminCategory.reorderAttributes(child.id, [b.id, a.id]);
    expect(ordered.map((x) => x.name)).toEqual(['Beta', 'Alpha']);

    await expect(adminCategory.reorderAttributes(child.id, [a.id, foreign.id])).rejects.toThrow(
      /do not belong to this category/i,
    );
  });

  it('returns the taxonomy as a tree with counts', async () => {
    const parent = await top('TreeTop');
    const child = await leaf('TreeLeaf', parent.id);
    await listing(child.id);
    await adminCategory.createAttribute(child.id, {
      name: 'Spec',
      type: 'TEXT',
      options: [],
      isRequired: false,
      appliesTo: 'PRODUCT',
      sortOrder: 0,
    });

    const tree = await adminCategory.adminCategoryTree(true);
    const node = tree.find((t) => t.id === parent.id);

    expect(node?.children).toHaveLength(1);
    expect(node?.children[0]).toMatchObject({ productCount: 1, attributeCount: 1 });
  });
});
