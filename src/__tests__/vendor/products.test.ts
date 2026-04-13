import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import prisma from '../../configs/prismaConfig';
import { createTestUser } from '../helpers';
import { ProductService } from '../../services/product.management.service';
import type { ProductContext } from '../../services/product.management.service';

function vendorContext(vendorId: string): ProductContext {
  return { role: 'vendor', userId: vendorId, vendorId };
}

function adminContext(): ProductContext {
  return { role: 'admin', userId: 'admin-test-user' };
}

async function cleanupTestData() {
  const vendorProducts = await prisma.product.findMany({
    where: { vendorId: { not: null } },
    select: { id: true },
  });
  const ids = vendorProducts.map((p) => p.id);

  if (ids.length > 0) {
    await prisma.digitalAsset.deleteMany({ where: { productId: { in: ids } } });
    await prisma.wishlistItem.deleteMany({ where: { productId: { in: ids } } });
    await prisma.review.deleteMany({ where: { productId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { productId: { in: ids } } });
    await prisma.cartItem.deleteMany({ where: { productId: { in: ids } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }

  // Also clean up admin-created test products
  const adminProducts = await prisma.product.findMany({
    where: { stockKeepingUnit: { startsWith: 'TEST-' } },
    select: { id: true },
  });
  const adminIds = adminProducts.map((p) => p.id);
  if (adminIds.length > 0) {
    await prisma.digitalAsset.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.wishlistItem.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.review.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.orderItem.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.cartItem.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.productVariant.deleteMany({ where: { productId: { in: adminIds } } });
    await prisma.product.deleteMany({ where: { id: { in: adminIds } } });
  }

  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: 'vendor-' } } });
}

describe('ProductService', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  async function createVendorUser(slug: string) {
    return createTestUser({
      userId: `vendor-${slug}`,
      isVendor: true,
      vendorStatus: 'ACTIVE',
      storeName: `${slug} Store`,
      storeSlug: slug,
    });
  }

  // ── Vendor Create ─────────────────────────────────────────────

  it('creates a digital product for a vendor', async () => {
    const vendor = await createVendorUser('gadgets');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'E-Book Guide',
      description: 'A digital guide to everything',
      basePrice: 5000,
      tags: ['ebook', 'guide'],
      images: [],
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
    const service = new ProductService(vendorContext(vendor.userId));

    const p1 = await service.create({
      name: 'My Product',
      description: 'First product',
      basePrice: 1000,
      tags: [],
      images: [],
    });

    const p2 = await service.create({
      name: 'My Product',
      description: 'Second product with same name',
      basePrice: 2000,
      tags: [],
      images: [],
    });

    expect(p1.slug).toBe('my-product');
    expect(p2.slug).not.toBe('my-product');
    expect(p2.slug).toMatch(/^my-product-/);
  });

  it('creates product with variants', async () => {
    const vendor = await createVendorUser('variants');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'Template Pack',
      description: 'Various templates',
      basePrice: 10000,
      tags: [],
      images: [],
      variants: [
        { name: 'Basic', attributes: { tier: 'basic' }, price: 5000, stock: 0, isActive: true },
        { name: 'Pro', attributes: { tier: 'pro' }, price: 15000, stock: 0, isActive: true },
      ],
    });

    expect(product.variants).toHaveLength(2);
    expect(product.variants[0].name).toBe('Basic');
    expect(product.variants[1].name).toBe('Pro');
  });

  // ── Admin Create ──────────────────────────────────────────────

  it('creates a physical product for admin with provided stock/type', async () => {
    const service = new ProductService(adminContext());

    const product = await service.create({
      name: 'Admin Physical Product',
      description: 'A physical product',
      basePrice: 15000,
      stockKeepingUnit: 'TEST-ADMIN-001',
      type: 'PHYSICAL',
      stock: 50,
      tags: [],
      images: [],
    });

    expect(product.type).toBe('PHYSICAL');
    expect(product.stock).toBe(50);
    expect(product.stockKeepingUnit).toBe('TEST-ADMIN-001');
  });

  // ── Vendor List ───────────────────────────────────────────────

  it('lists only the vendor\'s own products', async () => {
    const vendor1 = await createVendorUser('shop-a');
    const vendor2 = await createVendorUser('shop-b');
    const service1 = new ProductService(vendorContext(vendor1.userId));
    const service2 = new ProductService(vendorContext(vendor2.userId));

    await service1.create({
      name: 'Vendor1 Product',
      description: 'From vendor 1',
      basePrice: 500,
      tags: [],
      images: [],
    });

    await service2.create({
      name: 'Vendor2 Product',
      description: 'From vendor 2',
      basePrice: 600,
      tags: [],
      images: [],
    });

    const result = await service1.list({
      page: 1,
      limit: 20,
      status: 'all',
      stock: 'all',
      sortBy: 'newest',
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Vendor1 Product');
    expect(result.pagination.total).toBe(1);
  });

  // ── Admin List (returns all) ──────────────────────────────────

  it('admin list returns all vendors\' products', async () => {
    const vendor1 = await createVendorUser('list-a');
    const vendor2 = await createVendorUser('list-b');
    const svc1 = new ProductService(vendorContext(vendor1.userId));
    const svc2 = new ProductService(vendorContext(vendor2.userId));
    const adminSvc = new ProductService(adminContext());

    await svc1.create({ name: 'V1 Product', description: 'v1', basePrice: 500, tags: [], images: [] });
    await svc2.create({ name: 'V2 Product', description: 'v2', basePrice: 600, tags: [], images: [] });

    const result = await adminSvc.list({
      page: 1,
      limit: 100,
      status: 'all',
      stock: 'all',
      sortBy: 'newest',
    });

    const names = result.data.map((p) => p.name);
    expect(names).toContain('V1 Product');
    expect(names).toContain('V2 Product');
  });

  // ── Get ───────────────────────────────────────────────────────

  it('gets a single product belonging to the vendor', async () => {
    const vendor = await createVendorUser('single');
    const service = new ProductService(vendorContext(vendor.userId));

    const created = await service.create({
      name: 'Solo Product',
      description: 'Just one',
      basePrice: 3000,
      tags: [],
      images: [],
    });

    const fetched = await service.get(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Solo Product');
  });

  it('rejects access to another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('owner');
    const vendor2 = await createVendorUser('intruder');
    const service1 = new ProductService(vendorContext(vendor1.userId));
    const service2 = new ProductService(vendorContext(vendor2.userId));

    const product = await service1.create({
      name: 'Private Product',
      description: 'Belongs to vendor1',
      basePrice: 7000,
      tags: [],
      images: [],
    });

    await expect(service2.get(product.id)).rejects.toThrow(/do not have access/);
  });

  it('admin can access any vendor\'s product', async () => {
    const vendor = await createVendorUser('any-access');
    const vendorSvc = new ProductService(vendorContext(vendor.userId));
    const adminSvc = new ProductService(adminContext());

    const product = await vendorSvc.create({
      name: 'Vendor Product',
      description: 'Accessible by admin',
      basePrice: 5000,
      tags: [],
      images: [],
    });

    const fetched = await adminSvc.get(product.id);
    expect(fetched.id).toBe(product.id);
  });

  // ── Update ────────────────────────────────────────────────────

  it('updates a vendor product', async () => {
    const vendor = await createVendorUser('updater');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'Old Name',
      description: 'Original description',
      basePrice: 4000,
      tags: [],
      images: [],
    });

    const updated = await service.update(product.id, {
      name: 'New Name',
      basePrice: 5500,
    });

    expect(updated.name).toBe('New Name');
    expect(updated.slug).toBe('new-name');
    expect(updated.basePrice).toBe(5500);
  });

  it('rejects update to another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('real-owner');
    const vendor2 = await createVendorUser('attacker');
    const service1 = new ProductService(vendorContext(vendor1.userId));
    const service2 = new ProductService(vendorContext(vendor2.userId));

    const product = await service1.create({
      name: 'Protected Product',
      description: 'Cannot be updated by others',
      basePrice: 2000,
      tags: [],
      images: [],
    });

    await expect(
      service2.update(product.id, { name: 'Hijacked' })
    ).rejects.toThrow(/do not have access/);
  });

  it('admin can update any vendor product', async () => {
    const vendor = await createVendorUser('admin-update');
    const vendorSvc = new ProductService(vendorContext(vendor.userId));
    const adminSvc = new ProductService(adminContext());

    const product = await vendorSvc.create({
      name: 'Vendor Product',
      description: 'Admin will update this',
      basePrice: 3000,
      tags: [],
      images: [],
    });

    const updated = await adminSvc.update(product.id, { name: 'Admin Updated' });
    expect(updated.name).toBe('Admin Updated');
  });

  it('replaces variants on update', async () => {
    const vendor = await createVendorUser('variant-update');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'Variant Product',
      description: 'Has variants',
      basePrice: 8000,
      tags: [],
      images: [],
      variants: [
        { name: 'Basic', attributes: { tier: 'basic' }, price: 5000, stock: 0, isActive: true },
      ],
    });

    expect(product.variants).toHaveLength(1);

    const updated = await service.update(product.id, {
      variants: [
        { name: 'Starter', attributes: { tier: 'starter' }, price: 3000, stock: 0, isActive: true },
        { name: 'Enterprise', attributes: { tier: 'enterprise' }, price: 20000, stock: 0, isActive: true },
      ],
    });

    expect(updated.variants).toHaveLength(2);
    expect(updated.variants[0].name).toBe('Starter');
    expect(updated.variants[1].name).toBe('Enterprise');
  });

  // ── Delete ────────────────────────────────────────────────────

  it('soft-deletes a vendor product', async () => {
    const vendor = await createVendorUser('deleter');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'Doomed Product',
      description: 'Will be deactivated',
      basePrice: 1500,
      tags: [],
      images: [],
    });

    await service.delete(product.id);

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after!.isActive).toBe(false);
  });

  it('rejects delete of another vendor\'s product', async () => {
    const vendor1 = await createVendorUser('safe-owner');
    const vendor2 = await createVendorUser('delete-attacker');
    const service1 = new ProductService(vendorContext(vendor1.userId));
    const service2 = new ProductService(vendorContext(vendor2.userId));

    const product = await service1.create({
      name: 'Safe Product',
      description: 'Cannot be deleted by others',
      basePrice: 3000,
      tags: [],
      images: [],
    });

    await expect(service2.delete(product.id)).rejects.toThrow(/do not have access/);
  });

  it('admin can delete any product', async () => {
    const vendor = await createVendorUser('admin-del');
    const vendorSvc = new ProductService(vendorContext(vendor.userId));
    const adminSvc = new ProductService(adminContext());

    const product = await vendorSvc.create({
      name: 'Admin Delete Target',
      description: 'Admin will delete this',
      basePrice: 2000,
      tags: [],
      images: [],
    });

    await adminSvc.delete(product.id);

    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after!.isActive).toBe(false);
  });

  // ── Toggle ────────────────────────────────────────────────────

  it('toggles product active status', async () => {
    const vendor = await createVendorUser('toggler');
    const service = new ProductService(vendorContext(vendor.userId));

    const product = await service.create({
      name: 'Toggle Product',
      description: 'Will be toggled',
      basePrice: 2500,
      tags: [],
      images: [],
    });

    expect(product.isActive).toBe(true);

    const deactivated = await service.toggle(product.id, false);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await service.toggle(product.id, true);
    expect(reactivated.isActive).toBe(true);
  });

  // ── Context validation ────────────────────────────────────────

  it('throws if vendor context is missing vendorId', () => {
    expect(() => new ProductService({ role: 'vendor', userId: 'test' })).toThrow(
      /vendorId/
    );
  });
});
