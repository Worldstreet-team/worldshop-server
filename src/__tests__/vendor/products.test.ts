import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as vendorProductService from '../../services/vendor.product.service';

async function cleanupVendorTestData() {
  // Find all vendor-created products (vendorId is not null)
  const vendorProducts = await prisma.product.findMany({
    where: { vendorId: { not: null } },
    select: { id: true },
  });
  const ids = vendorProducts.map((p) => p.id);

  if (ids.length > 0) {
    await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: 'vendor-' } } });
}

describe('vendor product management', () => {
  // Clean up any stale data from previous failed runs
  beforeAll(async () => {
    await cleanupVendorTestData();
  });

  afterEach(async () => {
    await cleanupVendorTestData();
  });

  // ── Helper to create a vendor user ──────────────────────────────
  async function createVendorUser(slug: string) {
    return createTestUser({
      userId: `vendor-${slug}`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: `${slug} Store`,
      storeSlug: slug,
    });
  }

  // ── Create ──────────────────────────────────────────────────────

  it('creates a digital product for a vendor', async () => {
    const vendor = await createVendorUser('gadgets');

    const product = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'E-Book Guide',
      description: 'A digital guide to everything',
      basePrice: 5000,
      tags: ['ebook', 'guide'],
    });

    expect(product.name).toBe('E-Book Guide');
    expect(product.slug).toBe('e-book-guide');
    expect(product.vendorId).toBe(vendor.userId);
    expect(product.type).toBe('DIGITAL');
    expect(product.approvalStatus).toBe('APPROVED');
    expect(product.stock).toBe(999999);
    expect(product.basePrice).toBe(5000);
  });

  it('generates unique slug on duplicate name', async () => {
    const vendor = await createVendorUser('dupslug');

    const p1 = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'My Product',
      description: 'First product',
      basePrice: 1000,
    });

    const p2 = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'My Product',
      description: 'Second product with same name',
      basePrice: 2000,
    });

    expect(p1.slug).toBe('my-product');
    expect(p2.slug).not.toBe('my-product');
    expect(p2.slug).toMatch(/^my-product-/);
  });

  it('creates product with variants', async () => {
    const vendor = await createVendorUser('variants');

    const product = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'Template Pack',
      description: 'Various templates',
      basePrice: 10000,
      variants: [
        { name: 'Basic', attributes: { tier: 'basic' }, price: 5000, stock: 0, isActive: true },
        { name: 'Pro', attributes: { tier: 'pro' }, price: 15000, stock: 0, isActive: true },
      ],
    });

    expect(product.variants).toHaveLength(2);
    expect(product.variants[0].name).toBe('Basic');
    expect(product.variants[1].name).toBe('Pro');
  });

  // ── Read ────────────────────────────────────────────────────────

  it('lists only the vendor\'s own products', async () => {
    const vendor1 = await createVendorUser('shop-a');
    const vendor2 = await createVendorUser('shop-b');

    await vendorProductService.vendorCreateProduct(vendor1.userId, {
      name: 'Vendor1 Product',
      description: 'From vendor 1',
      basePrice: 500,
    });

    await vendorProductService.vendorCreateProduct(vendor2.userId, {
      name: 'Vendor2 Product',
      description: 'From vendor 2',
      basePrice: 600,
    });

    const result = await vendorProductService.vendorListProducts(vendor1.userId, {
      page: 1,
      limit: 20,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Vendor1 Product');
    expect(result.pagination.total).toBe(1);
  });

  it('gets a single product belonging to the vendor', async () => {
    const vendor = await createVendorUser('single');

    const created = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'Solo Product',
      description: 'Just one',
      basePrice: 3000,
    });

    const fetched = await vendorProductService.vendorGetProduct(vendor.userId, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Solo Product');
  });

  it('rejects access to another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('owner');
    const vendor2 = await createVendorUser('intruder');

    const product = await vendorProductService.vendorCreateProduct(vendor1.userId, {
      name: 'Private Product',
      description: 'Belongs to vendor1',
      basePrice: 7000,
    });

    await expect(
      vendorProductService.vendorGetProduct(vendor2.userId, product.id)
    ).rejects.toThrow(/do not have access/);
  });

  // ── Update ──────────────────────────────────────────────────────

  it('updates a vendor product', async () => {
    const vendor = await createVendorUser('updater');

    const product = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'Old Name',
      description: 'Original description',
      basePrice: 4000,
    });

    const updated = await vendorProductService.vendorUpdateProduct(vendor.userId, product.id, {
      name: 'New Name',
      basePrice: 5500,
    });

    expect(updated!.name).toBe('New Name');
    expect(updated!.slug).toBe('new-name');
    expect(updated!.basePrice).toBe(5500);
  });

  it('rejects update to another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('real-owner');
    const vendor2 = await createVendorUser('attacker');

    const product = await vendorProductService.vendorCreateProduct(vendor1.userId, {
      name: 'Protected Product',
      description: 'Cannot be updated by others',
      basePrice: 2000,
    });

    await expect(
      vendorProductService.vendorUpdateProduct(vendor2.userId, product.id, { name: 'Hijacked' })
    ).rejects.toThrow(/do not have access/);
  });

  // ── Delete ──────────────────────────────────────────────────────

  it('soft-deletes a vendor product', async () => {
    const vendor = await createVendorUser('deleter');

    const product = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'Doomed Product',
      description: 'Will be deactivated',
      basePrice: 1500,
    });

    await vendorProductService.vendorDeleteProduct(vendor.userId, product.id);

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after!.isActive).toBe(false);
  });

  it('rejects delete of another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('safe-owner');
    const vendor2 = await createVendorUser('delete-attacker');

    const product = await vendorProductService.vendorCreateProduct(vendor1.userId, {
      name: 'Safe Product',
      description: 'Cannot be deleted by others',
      basePrice: 3000,
    });

    await expect(
      vendorProductService.vendorDeleteProduct(vendor2.userId, product.id)
    ).rejects.toThrow(/do not have access/);
  });

  // ── Toggle ──────────────────────────────────────────────────────

  it('toggles product active status', async () => {
    const vendor = await createVendorUser('toggler');

    const product = await vendorProductService.vendorCreateProduct(vendor.userId, {
      name: 'Toggle Product',
      description: 'Will be toggled',
      basePrice: 2500,
    });

    expect(product.isActive).toBe(true);

    const deactivated = await vendorProductService.vendorToggleProduct(vendor.userId, product.id, false);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await vendorProductService.vendorToggleProduct(vendor.userId, product.id, true);
    expect(reactivated.isActive).toBe(true);
  });
});
