import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import * as storeService from '../../services/store.service';
import { enrichWithVendorInfo } from '../../services/product.service';

async function cleanupStoreTestData() {
  const vendorProducts = await prisma.product.findMany({
    where: { vendorId: { startsWith: 'store-' } },
    select: { id: true },
  });
  const ids = vendorProducts.map((p) => p.id);

  if (ids.length > 0) {
    await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: 'store-' } } });
}

describe('store page service', () => {
  beforeAll(async () => {
    await cleanupStoreTestData();
  });

  afterEach(async () => {
    await cleanupStoreTestData();
  });

  async function createVendorWithProducts(
    slug: string,
    opts: {
      vendorStatus?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
      products?: Array<{ name: string; isActive?: boolean; approvalStatus?: string }>;
    } = {},
  ) {
    const vendor = await createTestUser({
      userId: `store-${slug}`,
      isVendor: true,
      vendorStatus: opts.vendorStatus ?? 'ACTIVE',
      storeName: `${slug} Store`,
      storeSlug: slug,
      storeDescription: `Welcome to ${slug} Store`,
    });

    const products = [];
    for (const p of opts.products ?? []) {
      const sku = `${slug}-${p.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
      const product = await prisma.product.create({
        data: {
          name: p.name,
          slug: `${slug}-${p.name.toLowerCase().replace(/\s+/g, '-')}`,
          description: `${p.name} description`,
          stockKeepingUnit: sku,
          basePrice: 5000,
          vendorId: vendor.userId,
          isActive: p.isActive ?? true,
          approvalStatus: p.approvalStatus ?? 'APPROVED',
          type: 'DIGITAL',
          stock: 999999,
        },
      });
      products.push(product);
    }

    return { vendor, products };
  }

  // ── Basic store lookup ────────────────────────────────────────────

  it('returns store info and products for an active vendor', async () => {
    await createVendorWithProducts('alpha', {
      products: [{ name: 'Widget A' }, { name: 'Widget B' }],
    });

    const result = await storeService.getStoreBySlug('alpha', { page: 1, limit: 10 });

    expect(result).not.toBeNull();
    expect(result!.store.storeName).toBe('alpha Store');
    expect(result!.store.storeSlug).toBe('alpha');
    expect(result!.store.storeDescription).toBe('Welcome to alpha Store');
    expect(result!.store.productCount).toBe(2);
    expect(result!.products.data).toHaveLength(2);
    expect(result!.products.pagination.total).toBe(2);
  });

  it('returns null for non-existent slug', async () => {
    const result = await storeService.getStoreBySlug('no-such-store', { page: 1, limit: 10 });
    expect(result).toBeNull();
  });

  // ── Vendor status gates ───────────────────────────────────────────

  it('returns null for suspended vendor', async () => {
    await createVendorWithProducts('suspended-store', {
      vendorStatus: 'SUSPENDED',
      products: [{ name: 'Hidden Item' }],
    });

    const result = await storeService.getStoreBySlug('suspended-store', { page: 1, limit: 10 });
    expect(result).toBeNull();
  });

  it('returns null for banned vendor', async () => {
    await createVendorWithProducts('banned-store', {
      vendorStatus: 'BANNED',
      products: [{ name: 'Blocked Item' }],
    });

    const result = await storeService.getStoreBySlug('banned-store', { page: 1, limit: 10 });
    expect(result).toBeNull();
  });

  // ── Product visibility ────────────────────────────────────────────

  it('only returns active and approved products', async () => {
    await createVendorWithProducts('filtered', {
      products: [
        { name: 'Visible', isActive: true, approvalStatus: 'APPROVED' },
        { name: 'Inactive', isActive: false, approvalStatus: 'APPROVED' },
        { name: 'Pending', isActive: true, approvalStatus: 'PENDING' },
        { name: 'Rejected', isActive: true, approvalStatus: 'REJECTED' },
      ],
    });

    const result = await storeService.getStoreBySlug('filtered', { page: 1, limit: 10 });

    expect(result).not.toBeNull();
    expect(result!.products.data).toHaveLength(1);
    expect(result!.products.data[0].name).toBe('Visible');
    // productCount also reflects only active+approved
    expect(result!.store.productCount).toBe(1);
  });

  // ── Pagination ────────────────────────────────────────────────────

  it('paginates store products', async () => {
    await createVendorWithProducts('paged', {
      products: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }],
    });

    const page1 = await storeService.getStoreBySlug('paged', { page: 1, limit: 2 });
    expect(page1).not.toBeNull();
    expect(page1!.products.data).toHaveLength(2);
    expect(page1!.products.pagination.total).toBe(3);
    expect(page1!.products.pagination.totalPages).toBe(2);

    const page2 = await storeService.getStoreBySlug('paged', { page: 2, limit: 2 });
    expect(page2!.products.data).toHaveLength(1);
  });
});

describe('enrichWithVendorInfo', () => {
  beforeAll(async () => {
    await cleanupStoreTestData();
  });

  afterEach(async () => {
    await cleanupStoreTestData();
  });

  it('attaches vendor info to products with vendorId', async () => {
    const vendor = await createTestUser({
      userId: 'store-enrich-v1',
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: 'Enrich Store',
      storeSlug: 'enrich-store',
    });

    const products = [
      { id: '1', vendorId: vendor.userId, name: 'Vendor Product' },
      { id: '2', vendorId: null, name: 'Platform Product' },
    ];

    const enriched = await enrichWithVendorInfo(products);

    expect(enriched[0].vendor).toEqual({
      storeName: 'Enrich Store',
      storeSlug: 'enrich-store',
    });
    expect(enriched[1].vendor).toBeUndefined();
  });

  it('returns products unchanged when none have vendorId', async () => {
    const products = [
      { id: '1', vendorId: null, name: 'P1' },
      { id: '2', name: 'P2' },
    ];

    const enriched = await enrichWithVendorInfo(products as any);
    expect(enriched[0].vendor).toBeUndefined();
    expect(enriched[1].vendor).toBeUndefined();
  });
});
